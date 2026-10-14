export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'admin' | 'user';
  verified: boolean;
  susp: Suspension | null;
}

export interface Suspension {
  until: number | null;
  reason: string;
}

export interface Post {
  id: string;
  uid: string;
  text: string;
  media: Media[];
  ts: number;
  status: 'live' | 'hidden' | 'removed';
  edited?: boolean;
  processingUntil?: number;
  removedReason?: string;
}

export interface Media {
  type: 'image' | 'video';
  src?: string;
  gen?: string;
  dur?: number;
}

export interface Comment {
  id: string;
  pid: string;
  uid: string;
  text: string;
  ts: number;
  status: 'live' | 'removed';
}

export interface Report {
  id: string;
  type: 'post' | 'comment';
  targetId: string;
  by: string;
  reason: string;
  note: string;
  ts: number;
  status: 'open' | 'dismissed' | 'actioned';
}

export interface Audit {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  reason: string;
}

export interface Settings {
  threshold: number;
}

export interface Database {
  users: User[];
  posts: Post[];
  comments: Comment[];
  reports: Report[];
  audit: Audit[];
  settings: Settings;
  meId: string | null;
  lang: 'en' | 'ne';
}

export interface ComposerState {
  postId: string | null;
  media: Media[];
}
