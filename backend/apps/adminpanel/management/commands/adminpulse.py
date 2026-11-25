"""Stamp one of the outside reporters so the alert desk can say something true about it.

A backup job, an uptime probe, an error collector and a transcoder all live outside
this codebase. The console cannot invent their numbers, so this command is the wire:
whatever runs them calls it after the fact, from cron, from a deploy step, from a
monitor, and the alerts desk reads the last thing it was told.

Three answers the desk can tell apart, and they mean three different things:
never stamped (nobody wired this up), stamped and gone quiet (the job stopped),
stamped and reporting trouble (the job is running and something is wrong).
"""

import json
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.adminpanel.models import AdminPulse


class Command(BaseCommand):
    help = (
        'Record what an outside job (backup, uptime probe, error collector, media queue) '
        'last reported, so the admin alerts desk can speak for it.'
    )

    def add_arguments(self, parser):
        # `nargs='?'` because `--list` is a whole run of this command and does not
        # name a reporter: making the key required would force `adminpulse list list`.
        parser.add_argument('key', nargs='?', default='', help='One of: web, backup, errors, jobs')
        parser.add_argument('--label', default='', help='What to call it on the screen.')
        parser.add_argument('--state', default='ok', choices=[item for item, _l in AdminPulse.State.choices])
        parser.add_argument('--detail', default='', help='The sentence the seat reads under it.')
        parser.add_argument('--counts', default='', help='JSON object, e.g. \'{"waiting": 41}\'')
        parser.add_argument('--stamped-at', default='', help='ISO timestamp, for backfilling a missed run.')
        parser.add_argument('--list', action='store_true', help='Show every reporter and stop.')

    def handle(self, *args, **options):
        if options['list']:
            self.stdout.write(self._table())
            return

        key = str(options['key'] or '').strip().lower()
        if not key:
            raise CommandError('Name the reporter: web, backup, errors or jobs.')
        counts = self._counts(options['counts'])
        stamped = self._when(options['stamped_at'])
        row, created = AdminPulse.objects.get_or_create(
            key=key,
            defaults={
                'label': options['label'] or key.title(), 'state': options['state'],
                'detail': options['detail'], 'counts': counts, 'stamped_at': stamped, 'stamps': 1,
            },
        )
        if not created:
            row.label = options['label'] or row.label or key.title()
            row.state = options['state']
            row.detail = options['detail'] or row.detail
            row.counts = counts or row.counts
            row.stamped_at = stamped
            row.stamps = (row.stamps or 0) + 1
            row.save()
        self.stdout.write(self.style.SUCCESS(
            f'{key}: {row.state} at {row.stamped_at:%Y-%m-%d %H:%M} UTC '
            f'({"first word" if created else f"report {row.stamps}"}). '
            + (row.detail or '')
            + (f' Counts {json.dumps(row.counts)}.' if row.counts else '')
            + ' Open the alerts desk to see what the console makes of it.'
        ))

    @staticmethod
    def _counts(raw):
        text = str(raw or '').strip()
        if not text:
            return {}
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise CommandError(f'--counts has to be a JSON object: {exc}') from None
        if not isinstance(data, dict):
            raise CommandError('--counts has to be a JSON object, like {"waiting": 41}.')
        return data

    @staticmethod
    def _when(raw):
        text = str(raw or '').strip()
        if not text:
            return timezone.now()
        try:
            moment = datetime.fromisoformat(text)
        except ValueError as exc:
            raise CommandError(f'--stamped-at is not an ISO timestamp: {exc}') from None
        return timezone.make_aware(moment) if timezone.is_naive(moment) else moment

    @staticmethod
    def _table():
        rows = AdminPulse.objects.order_by('key')
        if not rows:
            return (
                'Nothing has ever reported to this console. Wire one in with '
                '`python manage.py adminpulse backup --state=ok --detail="nightly dump, 2.1 GB"`.'
            )
        return '\n'.join(
            f'{row.key:<8} {row.state:<5} {row.stamped_at:%Y-%m-%d %H:%M} UTC  '
            f'#{row.stamps}  {row.label}, {row.detail or "no sentence"}'
            for row in rows
        )
