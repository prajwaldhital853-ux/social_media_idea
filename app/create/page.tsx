'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import Avatar from '@/components/Avatar';
import { IC } from '@/lib/icons';
import { uid } from '@/lib/utils';

export default function CreatePostPage() {
  const router = useRouter();
  const { db, me, addPost, showToast } = useApp();
  const [text, setText] = useState('');
  const [media, setMedia] = useState<Array<{type: 'image' | 'video', src?: string, gen?: string, dur?: number}>>([]);
  const [mood, setMood] = useState('');
  const [userLocation, setUserLocation] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [text]);

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const type = file.type.startsWith('video') ? 'video' : 'image';
        setMedia(prev => [...prev, { type, src: result }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeMedia = (index: number) => {
    setMedia(prev => prev.filter((_, i) => i !== index));
  };

  const handlePost = () => {
    if (!text.trim() && media.length === 0) {
      showToast('Please add some content');
      return;
    }

    if (!me) {
      router.push('/login');
      return;
    }

    const newPost = {
      id: uid(),
      uid: me.id,
      text: text.trim(),
      media,
      ts: Date.now(),
      status: 'live' as const,
      mood: mood || undefined,
      place: userLocation || undefined,
    };

    addPost(newPost);
    showToast('Post created!');
    router.push('/');
  };

  if (!me) {
    router.push('/login');
    return null;
  }

  const charCount = text.length;
  const charLimit = 3000;

  return (
    <div className="create-post-page">
      <header className="create-post-header">
        <button 
          type="button" 
          className="icon-btn" 
          aria-label="Back"
          onClick={() => router.back()}
        >
          {IC.back}
        </button>
        <h1>Create post</h1>
        <button
          type="button"
          className="post-btn-header"
          onClick={handlePost}
          disabled={!text.trim() && media.length === 0}
        >
          Post
        </button>
      </header>

      <div className="create-post-body">
        <div className="create-post-author">
          <Avatar user={me} size={40} />
          <div>
            <div className="create-post-name">{me.name}</div>
            <div className="create-post-privacy">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
              Public
            </div>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          className="create-post-textarea"
          placeholder="What's on your mind?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={charLimit}
          rows={3}
        />

        {media.length > 0 && (
          <div className={`create-post-media ${media.length === 1 ? 'single' : 'grid'}`}>
            {media.map((item, index) => (
              <div key={index} className="create-post-media-item">
                {item.type === 'video' ? (
                  <video src={item.src} controls />
                ) : (
                  <img src={item.src || item.gen} alt="" />
                )}
                <button
                  type="button"
                  className="remove-media-btn"
                  onClick={() => removeMedia(index)}
                  aria-label="Remove media"
                >
                  {IC.x}
                </button>
              </div>
            ))}
          </div>
        )}

        {userLocation && (
          <div className="create-post-tag">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            {userLocation}
            <button onClick={() => setUserLocation('')} className="remove-tag-btn">{IC.x}</button>
          </div>
        )}

        {mood && (
          <div className="create-post-tag">
            <span>{mood}</span>
            <button onClick={() => setMood('')} className="remove-tag-btn">{IC.x}</button>
          </div>
        )}
      </div>

      <div className="create-post-actions">
        <div className="create-post-actions-label">Add to your post</div>
        <div className="create-post-action-buttons">
          <button
            type="button"
            className="create-action-btn photo"
            onClick={() => fileInputRef.current?.click()}
            title="Photo/video"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/>
            </svg>
          </button>
          <button
            type="button"
            className="create-action-btn location"
            onClick={() => {
              const loc = prompt('Enter location:');
              if (loc) setUserLocation(loc);
            }}
            title="Add location"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </button>
          <button
            type="button"
            className="create-action-btn feeling"
            onClick={() => {
              const feeling = prompt('How are you feeling?');
              if (feeling) setMood(feeling);
            }}
            title="Feeling/activity"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="create-post-footer">
        <div className="char-count">
          <span className={charCount > charLimit - 100 ? 'warning' : ''}>
            {charCount}/{charLimit}
          </span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleMediaSelect}
      />
    </div>
  );
}
