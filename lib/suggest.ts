import { Database, User } from './types';

/**
 * The two hops the server walks, written against the demo graph so a build
 * without an API still suggests friends of friends instead of whoever happens
 * to be cached. A signed-out visitor has no circle, so they get the popular
 * accounts — the same concession `/api/users/suggested/` makes.
 */
export function localSuggestions(db: Database, meId: string | null, limit = 30): User[] {
  const accepted = db.follows.filter(f => f.status !== 'pending');
  const followersOf = (id: string) => accepted.reduce((n, f) => n + (f.following === id ? 1 : 0), 0);
  const pool = db.users.filter(u => u.id !== meId && u.role === 'user');
  const byReach = (a: User, b: User, reach: Map<string, number>) =>
    (reach.get(b.id) || 0) - (reach.get(a.id) || 0)
    || Number(!!b.verified) - Number(!!a.verified)
    || followersOf(b.id) - followersOf(a.id);

  if (!meId) {
    return pool
      .sort((a, b) => Number(!!b.verified) - Number(!!a.verified) || followersOf(b.id) - followersOf(a.id))
      .slice(0, limit);
  }

  const neighbors = new Set<string>();
  accepted.forEach(f => {
    if (f.follower === meId) neighbors.add(f.following);
    else if (f.following === meId) neighbors.add(f.follower);
  });
  neighbors.delete(meId);

  const reach = new Map<string, Set<string>>();
  const touch = (candidate: string, near: string) => {
    if (candidate === meId) return;
    const seen = reach.get(candidate) || new Set<string>();
    seen.add(near);
    reach.set(candidate, seen);
  };
  accepted.forEach(f => {
    if (neighbors.has(f.follower)) touch(f.following, f.follower);
    if (neighbors.has(f.following)) touch(f.follower, f.following);
  });

  // Someone the viewer already asked about is not a suggestion, and neither is
  // anybody on either side of a block.
  const taken = new Set(accepted.filter(f => f.follower === meId).map(f => f.following));
  db.follows.filter(f => f.following === meId && f.status === 'pending').forEach(f => taken.add(f.follower));
  (db.blocks || []).forEach(id => taken.add(id));

  const counts = new Map<string, number>();
  reach.forEach((near, candidate) => counts.set(candidate, near.size));
  return pool
    .filter(u => counts.has(u.id) && !taken.has(u.id))
    .sort((a, b) => byReach(a, b, counts))
    .slice(0, limit);
}
