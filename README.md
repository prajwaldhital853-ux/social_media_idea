# Chautari - Modern Social Media Platform

A Twitter-inspired social media platform built with Next.js 14, featuring a modern UI, smooth animations, and full responsiveness.

## ✨ Features

- **Modern Twitter-Inspired UI**: Clean, contemporary design with light/dark mode support
- **Fully Responsive**: Optimized for desktop, tablet, and mobile devices
- **Rich Interactions**: Smooth animations for likes, retweets, and button clicks
- **Real Reference Images**: Posts feature high-quality images from Unsplash
- **Modern Login Screen**: Twitter-style authentication with social login options
- **"For You" Feed**: Personalized content discovery
- **Post Composer**: Create posts with media attachments
- **Comments System**: Reply to posts with threaded comments
- **Admin Dashboard**: Manage users, posts, and moderation
- **Client-Side Only**: No backend required - all data in LocalStorage

## 🎨 UI Highlights

### Design System
- **Light Mode Default**: Clean white background with subtle shadows
- **Automatic Dark Mode**: Respects system preferences
- **CSS Variables**: Easy theming and customization
- **Smooth Animations**: Fade-in, slide-up, and bounce effects
- **Interactive Elements**: Hover states and click feedback

### Components
- **TwitterSidebar**: Left navigation with icons and user profile
- **PostCard**: Modern post layout with engagement metrics
- **Composer**: Rich text input with media tools
- **ModernLogin**: Clean authentication screen
- **TwitterLayout**: Three-column responsive layout

## 📁 Project Structure

```
social_medial/
├── app/
│   ├── admin/
│   │   └── page.tsx          # Admin dashboard
│   ├── login/
│   │   └── page.tsx          # Modern login screen
│   ├── post/
│   │   └── [id]/
│   │       └── page.tsx      # Post detail with comments
│   ├── globals.css           # Twitter-inspired styles
│   ├── layout.tsx            # Root layout with context
│   └── page.tsx              # Home/feed page
├── components/
│   ├── AppLayout.tsx         # Legacy layout (unused)
│   ├── AuthArt.tsx           # SVG artwork (unused)
│   ├── Avatar.tsx            # Dynamic avatar component
│   ├── Feed.tsx              # Feed component with composer
│   ├── ModernLogin.tsx       # Twitter-style login
│   ├── PostCard.tsx          # Modern post card
│   ├── SideRail.tsx          # Legacy sidebar (unused)
│   ├── TopBar.tsx            # Legacy navbar (unused)
│   ├── TwitterLayout.tsx     # Modern 3-column layout
│   ├── TwitterSidebar.tsx    # Left navigation
│   ├── Wordmark.tsx          # Logo component
│   └── ...
├── lib/
│   ├── AppContext.tsx        # Global state management
│   ├── icons.tsx             # SVG icons
│   ├── i18n.ts               # Translations
│   ├── seed.ts               # Demo data with real images
│   ├── storage.ts            # LocalStorage helpers
│   ├── types.ts              # TypeScript types
│   └── utils.ts              # Utility functions
├── public/                   # Static assets
├── next.config.js            # Next.js config
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── README.md                 # This file
```

## 🚀 Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Production Build

```bash
npm run build
npm start
```

## 🎯 Demo Usage

1. **Login**: The login screen appears first. Click "Sign in" for demo access
2. **Feed**: View posts from different users with real images
3. **Interact**: Like posts (with animation), retweet, comment
4. **Create**: Use the composer to post new content
5. **Admin**: Access admin dashboard by logging in as admin user

### Demo Credentials
- **Admin**: `admin@chautari.demo` (any password)
- **Regular User**: Any demo user from the seed data

## 🛠️ Technology Stack

- **Next.js 14**: React framework with App Router
- **React 18**: UI library
- **TypeScript**: Type safety
- **CSS Variables**: Theming system
- **LocalStorage**: Data persistence
- **DiceBear API**: Dynamic avatars
- **Unsplash**: Real reference images

## 🎨 Customization

### Colors
Edit CSS variables in `app/globals.css`:
```css
:root {
  --ink: #0F1419;
  --paper: #FFFFFF;
  --blue: #1D9BF0;
  --red: #F4212E;
  --green: #00BA7C;
}
```

### Seed Data
Modify `lib/seed.ts` to add/change demo posts and users

### Animations
Adjust keyframes in `app/globals.css` for different animation effects

## 📱 Responsive Breakpoints

- **Desktop**: > 1280px (3-column layout)
- **Tablet**: 1000px - 1280px (2-column layout)
- **Mobile**: < 768px (Single column with bottom nav)

## 🔐 Authentication

The app uses demo authentication:
- LocalStorage-based session management
- No actual backend required
- Social login buttons are simulated
- Session persists across page refreshes

## 📊 Data Structure

All data stored in LocalStorage under `chautari-demo-v1`:
- Users with profiles
- Posts with media
- Comments
- Reports (for moderation)
- Audit log
- Settings

## 🎯 Key Features Implemented

### ✅ Light Mode
- Default light theme
- Automatic dark mode based on system preference
- Smooth theme transitions

### ✅ Animations
- Like button bounce effect
- Post slide-in animation
- Modal fade-in/scale-in
- Button hover states
- Smooth scrolling

### ✅ Post Design
- Twitter-inspired layout
- Verified badges
- Engagement metrics (likes, retweets, comments, views)
- Media grid support (1-4 images)
- Video support with duration indicator

### ✅ Mobile Compatibility
- Bottom navigation bar
- Touch-friendly buttons
- Responsive post cards
- Optimized composer

### ✅ Real Images
- Unsplash integration for post media
- DiceBear for avatars
- High-quality placeholder images

## 📝 Notes

- This is a frontend demo - no production backend
- All data is client-side and temporary
- File uploads use Blob URLs (local only)
- Perfect for UI/UX prototyping and demonstration

