from django.db import models


class MediaBlob(models.Model):
    """Uploaded bytes that have to outlive the server they were sent to.

    A hosted filesystem is rebuilt from the image on every deploy, so a photo
    written to /media is gone at the next push. The demo's database is the one
    thing that survives, so small uploads are kept here under the same key the
    URL already names, and /media answers from this row before the disk.
    """

    key = models.CharField(max_length=160, unique=True)
    content_type = models.CharField(max_length=60)
    size = models.PositiveIntegerField()
    data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.key} ({self.size} bytes)'
