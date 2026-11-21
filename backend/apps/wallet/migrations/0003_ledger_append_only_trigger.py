from django.db import migrations

TRIGGER_FN = """
CREATE OR REPLACE FUNCTION wallet_ledger_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are append-only.';
END;
$$ LANGUAGE plpgsql;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('wallet', '0002_coinrequest_transaction_ledger_wallet_recent_and_more'),
    ]

    operations = [
        migrations.RunSQL(
            sql=TRIGGER_FN + """
            CREATE TRIGGER wallet_ledger_no_update
                BEFORE UPDATE ON wallet_transaction
                FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();
            CREATE TRIGGER wallet_ledger_no_delete
                BEFORE DELETE ON wallet_transaction
                FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();
            """,
            reverse_sql="""
            DROP TRIGGER IF EXISTS wallet_ledger_no_update ON wallet_transaction;
            DROP TRIGGER IF EXISTS wallet_ledger_no_delete ON wallet_transaction;
            DROP FUNCTION IF EXISTS wallet_ledger_append_only();
            """,
        ),
    ]