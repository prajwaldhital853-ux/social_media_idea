"""The features desk: five doors a seat can close on the member site.

Two halves on one screen, because a switch nobody can prove moved is a switch nobody
trusts. The rows are the five `feature_*` settings, and beside them is what the member
app is being told right now at `GET /api/meta/`, read the same way the endpoints read it
-- so the seat sees the answer a stranger's browser will act on, not only the value they
typed.

A closed door is not a deleted one. Nothing here takes content out of the site: the
marketplace keeps showing its offers, a wallet keeps its balance, a thread keeps its
history. What stops is a member making something happen, and the endpoints say so even
to a client that never got the word.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common import features as switches

from . import rbac, settings_store
from .journal import record

KEYS = {name: row for name, (row, _sentence) in switches.FLAGS.items()}


def desk(staff=None):
    """Every switch, who last moved it, and the answer the site is running on."""
    live = switches.state()
    rows = {line['key']: line for line in settings_store.lines(keys=set(KEYS.values()))}
    lines = []
    for name, key in KEYS.items():
        lines.append({
            **rows[key],
            'feature': name,
            'on': bool(live.get(name, True)),
        })
    return {
        'lines': lines,
        'live': live,
        'can_write': rbac.can(staff, 'site_features') if staff is not None else False,
    }


def write(actor, posted):
    """Move the switches and publish the answer, so the next page reads the new one."""
    known = set(KEYS.values())
    updates, said = {}, []
    for key, value in (posted or {}).items():
        if key not in known:
            continue
        label = settings_store.DEFAULTS[key][2]
        on = str(value).strip().lower() in ('1', 'true', 'yes', 'on')
        # Off is written as `0` rather than left blank: a blank means "nobody has
        # touched this", which would put the shipped default -- open -- straight back.
        updates[key] = '1' if on else '0'
        said.append(f'{label.lower()} {"on" if on else "off"}')
    if not updates:
        return 400, {'detail': 'Nothing to save, no switch has been moved.'}
    settings_store.write(actor, updates)
    switches.clear()
    record(actor, 'site_features', 'site features', 'Turned ' + ', '.join(said) + '.')
    return 200, {
        'detail': 'Saved: ' + ', '.join(said) + '. The member app reads the new answer the next '
                  'time it loads the site config, and every door the feature owns answers with the '
                  'same sentence before it writes anything, so an older tab or a hand-made request '
                  'is turned away too.',
        'live': switches.state(),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@rbac.staff_only('site_features')
def features_desk(request):
    """Read the five switches, or move them and hand back what the site now runs."""
    if request.method == 'GET':
        return Response(desk(request.staff_account))
    code, body = write(request.user, request.data)
    if code == 200:
        body['can_write'] = True
        body['lines'] = desk(request.staff_account)['lines']
    return Response(body, status=code)
