'use client';

import LegalDoc from '@/components/LegalDoc';
import { useApp } from '@/lib/AppContext';

export default function TermsPage() {
  const { t } = useApp();
  return (
    <LegalDoc
      title={t('terms')}
      updated="20 November 2026"
      intro="These terms govern your use of Exposing, a reference social platform by NepTech Solutions. By creating an account or posting, you agree to them. The demo build runs in your browser and handles no real money."
      sections={[
        {
          h: 'The service',
          paras: ['Exposing lets people share photos, clips and stories, react and comment, follow each other, message privately, buy and sell in the Marketplace, and promote content with Coins. Features can be switched on or off by the platform administrators; when a feature is off, its pages are unavailable.']
        },
        {
          h: 'Eligibility and accounts',
          paras: ['You must be at least 13 years old. You are responsible for the accuracy of your account details and for activity under your account. One person, one account; impersonating others or misrepresenting affiliation is not allowed. Verified badges are granted by the platform and may not be faked.']
        },
        {
          h: 'Your content',
          paras: ['You keep ownership of what you post. By posting, you grant Exposing a non-exclusive licence to host and display it to the audience you choose (public, or followers only). Content stays until you delete it, nothing expires automatically. You may only post material you have the right to share.']
        },
        {
          h: 'Acceptable use',
          paras: ['The User Policy is part of these terms. Spam, harassment, hate speech, nudity, violence, scams and misinformation are prohibited. Breaking the rules can lead to content removal, warnings, suspension or permanent ban.']
        },
        {
          h: 'Coins and payments',
          list: [
            'Coins are the platform credit used for promotions. The NPR price per Coin is set by the administrators and shown in your Wallet.',
            'To buy Coins you submit a bank-transfer or QR payment request with its reference. An admin verifies the payment before Coins are added; unverified requests stay pending or are rejected with a reason.',
            'Requesting a promotion reserves its Coin cost immediately. Cancelling a pending request, or an admin rejecting it, returns the Coins in full.',
            'Coins have no cash value outside the platform and are not refundable once spent on an approved promotion. In this demo, no real payment is processed.'
          ]
        },
        {
          h: 'Promotions',
          paras: ['Promotions are reviewed before they go live. You choose the audience (category, age range, country and city); the platform shows the promotion only to matching users and labels it as Promoted. Impression and click counts are estimates. The platform may pause or end a promotion that breaks policy, refunding unused spend where fair.']
        },
        {
          h: 'Marketplace',
          paras: ['Listings are offers between users. Exposing is not a party to any sale, does not handle item payments, and does not guarantee items. Sellers must describe items honestly, honour the listed price, and mark items sold when they are gone. Prohibited items (weapons, drugs, stolen goods, counterfeit items, animals) may not be listed.']
        },
        {
          h: 'Moderation and enforcement',
          paras: ['Anyone can report content. When a post receives reports from the configured number of different people, it is hidden automatically while staff review it. Staff can remove content, warn, suspend (1, 7, 30 days or permanent) or reinstate accounts. Every staff action is written to an audit log.']
        },
        {
          h: 'Suspension and termination',
          paras: ['You can stop using Exposing at any time and delete your content. We may suspend or terminate accounts that break these terms. Sections on content licence, Coins and liability survive termination.']
        },
        {
          h: 'Disclaimers and liability',
          paras: ['The service is provided “as is”. To the extent permitted by law, Exposing and NepTech Solutions are not liable for indirect losses, lost profits, or disputes between users. Nothing in these terms limits liability that cannot legally be limited.']
        },
        {
          h: 'Changes and governing law',
          paras: ['We may update these terms; material changes are announced in-app with a new updated date. Continued use after changes means acceptance. These terms are governed by the laws of Nepal, and disputes go to the courts of Kathmandu.']
        },
        {
          h: 'Contact',
          paras: ['Questions about these terms: support@exposing.demo, or message the Exposing Team account in the app.']
        }
      ]}
    />
  );
}