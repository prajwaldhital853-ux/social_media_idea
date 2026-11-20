'use client';

import LegalDoc from '@/components/LegalDoc';
import { useApp } from '@/lib/AppContext';

export default function UserPolicyPage() {
  const { t } = useApp();
  return (
    <LegalDoc
      title={t('userPolicy')}
      updated="20 November 2026"
      intro="Exposing works when people share honestly and treat each other with respect. This policy sets the line between what belongs here and what does not. It applies to posts, reels, comments, reactions, profiles, messages and Marketplace listings."
      sections={[
        {
          h: 'Be authentic',
          paras: ['Use your own identity or a clearly labelled brand or fan account. Do not impersonate another person or organisation, and do not fake a verified badge. Parody and commentary accounts are welcome when they are obvious about what they are.']
        },
        {
          h: 'Respect other people',
          list: [
            'No harassment, bullying, threats or targeted abuse.',
            'No hate speech or dehumanising attacks based on caste, ethnicity, religion, gender, sexuality, disability or nationality.',
            'No sharing of private information about others (addresses, phone numbers, IDs) without consent.',
            'Disagree with ideas, not with people’s right to exist.'
          ]
        },
        {
          h: 'Keep it safe',
          paras: ['No content that promotes violence, self-harm, eating disorders or dangerous acts. No sexual content involving minors — this is reported to authorities. No graphic gore posted for shock value. News and documentary context may be allowed with a warning.']
        },
        {
          h: 'No nudity or sexual content',
          paras: ['Exposing is a general-audience platform. Nudity, pornography and sexually explicit content are not allowed, including in reels and Marketplace photos. Artistic or medical exceptions are rare and must be clearly contextualised.']
        },
        {
          h: 'No misinformation that causes harm',
          paras: ['Do not post false information that could cause real-world harm — fake health cures, manipulated media presented as real, or false claims about elections or emergencies. Honest mistakes happen; correct them when you learn better.']
        },
        {
          h: 'No spam or scams',
          list: [
            'No repetitive bulk posting, fake engagement, or buying/selling followers.',
            'No phishing, pyramid schemes, or “get rich quick” offers.',
            'No misleading links or fake giveaways.',
            'Marketplace listings must be real items at honest prices.'
          ]
        },
        {
          h: 'Respect intellectual property',
          paras: ['Post photos and clips you created or have permission to share. Credit creators. Do not upload pirated films, music or software. Report content that infringes your rights and we will review it.']
        },
        {
          h: 'Marketplace conduct',
          paras: ['Describe items accurately, including defects. Honour your listed price. Meet in safe public places for handover. Never list weapons, drugs, stolen or counterfeit goods, or animals. Mark items sold promptly.']
        },
        {
          h: 'How enforcement works',
          paras: ['Anyone can report content. When a post gets reports from the configured number of different people, it is hidden automatically while staff review. Staff can remove content, send a warning, or suspend an account for 1, 7, 30 days or permanently. Every action is logged.']
        },
        {
          h: 'Appeals',
          paras: ['If you think a decision was wrong, contact support@exposing.demo or message the Exposing Team with the post or account in question. A different moderator reviews appeals. We will tell you the outcome and the reason.']
        }
      ]}
    />
  );
}