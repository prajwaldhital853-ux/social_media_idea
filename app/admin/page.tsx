'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TwitterLayout from '@/components/TwitterLayout';
import { useApp } from '@/lib/AppContext';
import { esc, ago } from '@/lib/utils';

export default function AdminPage() {
  const { db, me, isAdmin, isAuthenticated } = useApp();
  const router = useRouter();
  const [adminTab, setAdminTab] = useState<'overview' | 'reports' | 'users' | 'audit' | 'settings'>('overview');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router, mounted]);

  useEffect(() => {
    if (mounted && !isAdmin()) {
      router.push('/');
    }
  }, [isAdmin, router, mounted]);

  if (!mounted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || !isAdmin()) {
    return null;
  }

  const openReports = db.reports.filter(r => r.status === 'open').length;

  return (
    <TwitterLayout>
      <header className="header">
        <div className="header-title">Admin Dashboard</div>
      </header>

      <div className="tabs">
        {(['overview', 'reports', 'users', 'audit', 'settings'] as const).map(tab => (
          <div
            key={tab}
            className={`tab ${adminTab === tab ? 'active' : ''}`}
            onClick={() => setAdminTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'reports' && openReports > 0 && ` (${openReports})`}
          </div>
        ))}
      </div>

      {adminTab === 'overview' && (
        <div style={{ padding: '16px' }}>
          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '800' }}>{db.users.length}</div>
              <div style={{ color: 'var(--muted)' }}>Users</div>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '800' }}>{db.posts.length}</div>
              <div style={{ color: 'var(--muted)' }}>Posts</div>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '800' }}>{db.comments.length}</div>
              <div style={{ color: 'var(--muted)' }}>Comments</div>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: '800' }}>{openReports}</div>
              <div style={{ color: 'var(--muted)' }}>Reports</div>
            </div>
          </div>

          <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '16px' }}>Recent Actions</h3>
          {db.audit.slice(0, 5).map(a => (
            <div key={a.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <b>{esc(a.action)}</b> <span style={{ color: 'var(--muted)' }}>{esc(a.target)}</span>
                {a.reason && <div style={{ color: 'var(--muted)', fontSize: '15px', marginTop: '4px' }}>{esc(a.reason)}</div>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
                @{esc(a.actor)} · {ago(a.ts, 'en')}
              </div>
            </div>
          ))}
        </div>
      )}

      {adminTab === 'users' && (
        <div style={{ padding: '16px' }}>
          {db.users.map(u => (
            <div key={u.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{esc(u.name || u.username)}</b> <span style={{ color: 'var(--muted)' }}>@{esc(u.username)}</span>
                <br />
                <span style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  {esc(u.email)} · {u.role === 'admin' ? 'Admin' : 'User'} · {db.posts.filter(p => p.uid === u.id).length} posts
                </span>
              </div>
              {u.role !== 'admin' && (
                <button style={{ padding: '8px 16px', borderRadius: '9999px', border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }}>
                  Manage
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adminTab === 'reports' && (
        <div style={{ padding: '16px' }}>
          {openReports === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px' }}>No open reports</p>
          ) : (
            db.reports
              .filter(r => r.status === 'open')
              .map(r => (
                <div key={r.id} style={{ padding: '16px', borderBottom: '1px solid var(--line)', background: 'var(--tint)', borderRadius: '8px', marginBottom: '8px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ padding: '4px 12px', borderRadius: '9999px', background: 'var(--line)', fontSize: '13px' }}>
                      {r.type === 'post' ? 'Post' : 'Comment'}
                    </span>
                    <span style={{ padding: '4px 12px', borderRadius: '9999px', background: 'var(--red)', color: 'white', fontSize: '13px', marginLeft: '8px' }}>
                      {r.reason}
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '15px' }}>{esc(r.note)}</div>
                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                    <button style={{ padding: '8px 16px', borderRadius: '9999px', border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }}>
                      Dismiss
                    </button>
                    <button style={{ padding: '8px 16px', borderRadius: '9999px', border: '1px solid var(--red)', color: 'var(--red)', background: 'transparent', cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {adminTab === 'audit' && (
        <div style={{ padding: '16px' }}>
          {db.audit.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px' }}>—</p>
          ) : (
            db.audit.map(a => (
              <div key={a.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <b>{esc(a.action)}</b> <span style={{ color: 'var(--muted)' }}>{esc(a.target)}</span>
                  {a.reason && <div style={{ color: 'var(--muted)', fontSize: '15px', marginTop: '4px' }}>{esc(a.reason)}</div>}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
                  @{esc(a.actor)} · {ago(a.ts, 'en')}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {adminTab === 'settings' && (
        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Auto-hide threshold
            </label>
            <input
              type="number"
              min="1"
              max="20"
              defaultValue={db.settings.threshold}
              style={{ padding: '12px', borderRadius: '4px', border: '1px solid var(--line)', width: '100%', maxWidth: '200px' }}
            />
            <div style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '4px' }}>
              Hide a post automatically after this many reports
            </div>
          </div>
        </div>
      )}
    </TwitterLayout>
  );
}
