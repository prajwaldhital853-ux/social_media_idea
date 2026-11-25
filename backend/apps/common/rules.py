"""The one question a member-facing write asks before it saves anything: the console's rules.

The lists themselves belong to Platform rules in the admin console, which owns the
table and the desk that edits it. What lives here is the door's side of the asking, so
a sentence carrying blocked wording is refused on the way in rather than published and
then hunted. The import is deliberately inside the function: the member API asks the
console a question, but must not need the console to load in order to answer a post.
"""


def blocked_wording(request, kind):
    """None when this write may be saved, otherwise the 400 to hand back instead."""
    from apps.adminpanel import policy

    return policy.check(request, kind)
