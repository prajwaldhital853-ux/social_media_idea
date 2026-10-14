'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Database, User, Post, Comment } from './types';
import { getDb, save } from './storage';
import { uid } from './utils';

interface AppContextType {
  db: Database;
  setDb: (db: Database) => void;
  me: User | null;
  isAdmin: () => boolean;
  addPost: (post: Post) => void;
  updatePost: (id: string, updates: Partial<Post>) => void;
  deletePost: (id: string) => void;
  addComment: (comment: Comment) => void;
  deleteComment: (id: string) => void;
  updateLang: (lang: 'en' | 'ne') => void;
  login: (userId: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(getDb());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      save(db);
    }
  }, [db, mounted]);

  const me = db.users.find(u => u.id === db.meId) || null;
  const isAuthenticated = !!me;

  const isAdmin = () => {
    return !!(me && me.role === 'admin');
  };

  const addPost = (post: Post) => {
    setDb(prev => ({
      ...prev,
      posts: [post, ...prev.posts]
    }));
  };

  const updatePost = (id: string, updates: Partial<Post>) => {
    setDb(prev => ({
      ...prev,
      posts: prev.posts.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  };

  const deletePost = (id: string) => {
    setDb(prev => ({
      ...prev,
      posts: prev.posts.filter(p => p.id !== id),
      comments: prev.comments.filter(c => c.pid !== id),
      reports: prev.reports.filter(r => !(r.type === 'post' && r.targetId === id))
    }));
  };

  const addComment = (comment: Comment) => {
    setDb(prev => ({
      ...prev,
      comments: [...prev.comments, comment]
    }));
  };

  const deleteComment = (id: string) => {
    setDb(prev => ({
      ...prev,
      comments: prev.comments.filter(c => c.id !== id),
      reports: prev.reports.filter(r => !(r.type === 'comment' && r.targetId === id))
    }));
  };

  const updateLang = (lang: 'en' | 'ne') => {
    setDb(prev => ({ ...prev, lang }));
  };

  const login = (userId: string) => {
    setDb(prev => ({ ...prev, meId: userId }));
  };

  const logout = () => {
    setDb(prev => ({ ...prev, meId: null }));
  };

  return (
    <AppContext.Provider
      value={{
        db,
        setDb,
        me,
        isAdmin,
        addPost,
        updatePost,
        deletePost,
        addComment,
        deleteComment,
        updateLang,
        login,
        logout,
        isAuthenticated
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
