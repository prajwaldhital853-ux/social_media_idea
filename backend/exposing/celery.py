import os
import socket

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'exposing.settings')

app = Celery('exposing')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()


def broker_available():
    url = os.environ.get('REDIS_URL', 'redis://127.0.0.1:6379/0')
    try:
        host_port = url.split('://', 1)[1].split('/', 1)[0]
        host, _, port = host_port.partition(':')
        with socket.create_connection((host, int(port or 6379)), timeout=0.3):
            return True
    except OSError:
        return False