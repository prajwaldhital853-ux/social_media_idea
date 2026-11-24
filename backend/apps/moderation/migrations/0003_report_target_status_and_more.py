"""Indexes for the report pile and the audit trail.

A report is nearly always read as "everything open against this one thing", which
starts with the target rather than the queue status the desk opens on. The audit
log is the fastest-growing table in the app and had no index at all.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('moderation', '0002_auditlog_report_report_queue_auditlog_actor'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='report',
            index=models.Index(fields=['target_type', 'target_id', 'status'], name='report_target_status'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['-created_at'], name='audit_newest'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['action', '-created_at'], name='audit_action_recent'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['target'], name='audit_target'),
        ),
    ]
