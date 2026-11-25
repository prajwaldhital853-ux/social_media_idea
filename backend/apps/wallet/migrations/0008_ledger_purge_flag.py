from django.db import migrations

# The 0003 function rejected every UPDATE and every DELETE on the ledger, which
# also made the account-deletion cascade impossible: deleting a member destroys
# their wallet, and the collector's DELETE rows tripped the trigger. The UPDATE
# refusal stays absolute; a DELETE now passes only inside a transaction that
# asked for a purge, which the deletion paths do after the money record has
# been copied to the archive.
PURGE_FN = """
CREATE OR REPLACE FUNCTION wallet_ledger_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Ledger entries are append-only.';
    END IF;
    IF current_setting('exposing.ledger_purge', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Ledger entries are append-only.';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
"""

OLD_FN = """
CREATE OR REPLACE FUNCTION wallet_ledger_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are append-only.';
END;
$$ LANGUAGE plpgsql;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0007_deletedwalletrecord'),
    ]

    operations = [
        migrations.RunSQL(sql=PURGE_FN, reverse_sql=OLD_FN),
    ]
