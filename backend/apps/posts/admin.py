from django.contrib import admin

from .models import Post, PostMedia


class PostMediaInline(admin.TabularInline):
    model = PostMedia
    extra = 0


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ['id', 'author', 'audience', 'status', 'created_at']
    list_filter = ['audience', 'status']
    inlines = [PostMediaInline]
