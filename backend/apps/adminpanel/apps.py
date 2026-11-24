from django.apps import AppConfig


class AdminPanelConfig(AppConfig):
    name = 'apps.adminpanel'

    def ready(self):
        # Imported here rather than at module top: the bell listens to models from
        # three other apps, and connecting before the registry is full is an error.
        from . import bell
        bell.connect()
