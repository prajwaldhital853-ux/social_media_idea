'use client';

import LegalDoc from '@/components/LegalDoc';
import { useApp } from '@/lib/AppContext';

export default function PrivacyPage() {
  const { t } = useApp();
  return (
    <LegalDoc
      title={t('privacy')}
      updated="20 November 2026"
      intro="Exposing is a reference social platform built by NepTech Solutions. This policy explains what the app stores, why it stores it, and the control you have over it. In this demo build, everything stays on your own device."
      sections={[
        {
          h: 'What this demo stores',
          paras: ['The demo runs entirely in your browser. There is no remote database in demo mode: your account, posts, photos, clips, reactions, comments, follows, messages, wallet history and reports are written to localStorage and IndexedDB on this device only.'],
          list: [
            'Account details you enter: name, username, email, date of birth, country, province, city and bio.',
            'Content you create: posts, reels, photos (resized to a maximum of 1280px), video clips, comments and reactions.',
            'Social graph: who you follow, who follows you, and what you save.',
            'Wallet records: Coin balance, purchase requests, payment references and promotion spend.',
            'Moderation records: reports you file and notices you receive.'
          ]
        },
        {
          h: 'What a production service would collect',
          paras: ['If Exposing is deployed as a live service, the same categories are stored on our servers instead of your device, plus basic technical logs (IP address, device type, request timestamps) needed to keep the service secure and reliable. We do not sell personal data, and we do not use your content to train advertising profiles.']
        },
        {
          h: 'How your data is used',
          list: [
            'To show the feed: public posts are visible to every visitor; followers-only posts are visible to the author and their followers.',
            'To deliver notifications about follows, reactions, comments, messages, Coins and moderation.',
            'To process Coin purchases: an admin compares the payment reference you submit against the bank or QR record.',
            'To moderate: reports are reviewed by staff, and posts reaching the report threshold are hidden automatically pending review.'
          ]
        },
        {
          h: 'Media and device storage',
          paras: ['Photos are compressed in your browser before saving. Video clips are kept in IndexedDB so they survive reloads without filling localStorage. Clearing site data, or using Settings → Reset demo data, removes all of it permanently.']
        },
        {
          h: 'Visibility and sharing',
          paras: ['Your profile shows your name, username, bio, location, join date and public posts to anyone. Your email, date of birth and wallet history are never shown on your public profile. Messages are visible only to the two people in the conversation.']
        },
        {
          h: 'Retention and deletion',
          paras: ['Nothing is deleted automatically. A post stays until its author deletes it; comments, likes and reactions stay until the user who made them removes them. Deleting a post also removes its comments, reactions and saves. You can edit or delete your own content at any time from the post menu.']
        },
        {
          h: 'Security',
          paras: ['Accounts can enable two-step verification in Settings. Staff actions are recorded in an audit log. In demo mode there is no password check, any password signs you in, so do not reuse real credentials or store real personal data in the demo.']
        },
        {
          h: 'Children',
          paras: ['Exposing is for people aged 13 and older. Signup requires a date of birth and an explicit age confirmation. Accounts found to belong to younger children are removed.']
        },
        {
          h: 'Your rights',
          list: [
            'Access and edit: everything you have stored is visible in the app; profile fields are editable in Settings.',
            'Delete: remove any post, comment or reaction you created; reset the whole demo from Settings.',
            'Object: report content or conduct that breaks the User Policy; moderation decisions are logged.'
          ]
        },
        {
          h: 'Changes and contact',
          paras: ['We will post material changes to this policy on this page with a new updated date. Questions go to support@exposing.demo or the Exposing Team account inside the app.']
        }
      ]}
    />
  );
}