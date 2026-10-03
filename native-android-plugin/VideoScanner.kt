package com.mmplayer.app

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class FoundVideo(
  val id: String,
  val path: String,
  val name: String,
  val ext: String,
  val size: Long,
  val mtime: Long,
  val diskFolder: String,
  val duration: Double?,
  val width: Int?,
  val height: Int?
)

object VideoIds {
  private val exts = setOf(
    ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".flv", ".ts", ".mts",
    ".m2ts", ".3gp", ".mpg", ".mpeg", ".m2v", ".asf", ".ogv", ".f4v", ".vob", ".divx"
  )
  private val skipParts = setOf(
    "node_modules", ".git", ".svn", "\$recycle.bin", "system volume information",
    "__pycache__", ".trash", "thumbs", ".tmp", ".temp", "temp", "tmp", "cache",
    ".cache", ".thumbnails", "thumbnails", ".trashed"
  )

  fun isVideo(name: String): Boolean {
    val ext = extOf(name)
    return ext in exts
  }

  fun extOf(name: String): String = "." + name.substringAfterLast('.', "").lowercase()

  fun isJunk(name: String, relative: String): Boolean {
    val n = name.lowercase()
    if (n.startsWith(".")) return true
    if (n.startsWith(".temp") || n.startsWith(".tmp")) return true
    if (n.endsWith(".tmp") || n.endsWith(".temp") || n.endsWith(".part") || n.endsWith(".download")) return true
    val hay = "$relative/$n".lowercase().replace('\\', '/')
    return hay.split('/').any { part ->
      part.isNotEmpty() && (
        part.startsWith(".") ||
          part in skipParts ||
          part.startsWith(".temp") ||
          part.startsWith("tmp") && part.length > 8
        )
    }
  }

  fun sha1(path: String): String {
    val key = path.replace('\\', '/').lowercase()
    val digest = MessageDigest.getInstance("SHA-1").digest(key.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }

  fun mimeFor(name: String): String {
    return when (extOf(name)) {
      ".mp4", ".m4v", ".f4v" -> "video/mp4"
      ".webm" -> "video/webm"
      ".mkv" -> "video/x-matroska"
      ".mov" -> "video/quicktime"
      ".avi", ".divx" -> "video/x-msvideo"
      ".wmv", ".asf" -> "video/x-ms-wmv"
      ".ogv" -> "video/ogg"
      ".ts", ".mts", ".m2ts" -> "video/mp2t"
      ".mpg", ".mpeg", ".m2v", ".vob" -> "video/mpeg"
      ".3gp" -> "video/3gpp"
      ".flv" -> "video/x-flv"
      else -> "application/octet-stream"
    }
  }

  fun normalizeFolder(relative: String, bucket: String): String {
    val cleaned = relative.replace('\\', '/').trim().trim('/')
    if (cleaned.isNotEmpty()) return cleaned
    return bucket.trim().trim('/').ifEmpty { "기타" }
  }
}

object VideoScanner {
  fun scanAll(
    context: Context,
    onProgress: (found: Int, currentDir: String) -> Unit
  ): List<FoundVideo> {
    val result = ArrayList<FoundVideo>()
    val uris = mediaUris(context)
    for (collection in uris) {
      queryCollection(context, collection, result, onProgress)
    }
    onProgress(result.size, "저장소")
    return result
  }

  private fun mediaUris(context: Context): List<Uri> {
    if (Build.VERSION.SDK_INT >= 29) {
      return MediaStore.getExternalVolumeNames(context).map { volume ->
        MediaStore.Video.Media.getContentUri(volume)
      }
    }
    return listOf(MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
  }

  private fun queryCollection(
    context: Context,
    collection: Uri,
    result: MutableList<FoundVideo>,
    onProgress: (found: Int, currentDir: String) -> Unit
  ) {
    val projection = mutableListOf(
      MediaStore.Video.Media._ID,
      MediaStore.Video.Media.DISPLAY_NAME,
      MediaStore.Video.Media.SIZE,
      MediaStore.Video.Media.DATE_MODIFIED,
      MediaStore.Video.Media.DURATION,
      MediaStore.Video.Media.WIDTH,
      MediaStore.Video.Media.HEIGHT,
      MediaStore.Video.Media.BUCKET_DISPLAY_NAME
    )
    val hasRelative = Build.VERSION.SDK_INT >= 29
    if (hasRelative) projection.add(MediaStore.Video.Media.RELATIVE_PATH)
    else projection.add(MediaStore.Video.Media.DATA)

    try {
      context.contentResolver.query(collection, projection.toTypedArray(), null, null, null)?.use { cursor ->
        val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
        val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
        val sizeIdx = cursor.getColumnIndex(MediaStore.Video.Media.SIZE)
        val timeIdx = cursor.getColumnIndex(MediaStore.Video.Media.DATE_MODIFIED)
        val durIdx = cursor.getColumnIndex(MediaStore.Video.Media.DURATION)
        val wIdx = cursor.getColumnIndex(MediaStore.Video.Media.WIDTH)
        val hIdx = cursor.getColumnIndex(MediaStore.Video.Media.HEIGHT)
        val bucketIdx = cursor.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)
        val relIdx = if (hasRelative) cursor.getColumnIndex(MediaStore.Video.Media.RELATIVE_PATH) else -1
        val dataIdx = if (hasRelative) -1 else cursor.getColumnIndex(MediaStore.Video.Media.DATA)
        var lastEmit = 0L
        while (cursor.moveToNext()) {
          val name = cursor.getString(nameIdx) ?: continue
          val relative = when {
            relIdx >= 0 -> (cursor.getString(relIdx) ?: "").trim('/')
            dataIdx >= 0 -> folderFromData(cursor.getString(dataIdx) ?: "")
            else -> ""
          }
          if (!VideoIds.isVideo(name) || VideoIds.isJunk(name, relative)) continue
          val size = if (sizeIdx >= 0) cursor.getLong(sizeIdx) else 0L
          if (size in 1 until 10_000) continue
          val id = cursor.getLong(idIdx)
          val uri = ContentUris.withAppendedId(collection, id).toString()
          val bucket = if (bucketIdx >= 0) cursor.getString(bucketIdx) ?: "" else ""
          val durationMs = if (durIdx >= 0) cursor.getLong(durIdx) else 0L
          result.add(
            FoundVideo(
              id = VideoIds.sha1(uri),
              path = uri,
              name = name,
              ext = VideoIds.extOf(name),
              size = size,
              mtime = if (timeIdx >= 0) cursor.getLong(timeIdx) * 1000L else 0L,
              diskFolder = VideoIds.normalizeFolder(relative, bucket),
              duration = if (durationMs > 0) durationMs / 1000.0 else null,
              width = if (wIdx >= 0 && !cursor.isNull(wIdx)) cursor.getInt(wIdx) else null,
              height = if (hIdx >= 0 && !cursor.isNull(hIdx)) cursor.getInt(hIdx) else null
            )
          )
          val now = System.currentTimeMillis()
          if (now - lastEmit > 80) {
            onProgress(result.size, relative.ifEmpty { bucket })
            lastEmit = now
          }
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun folderFromData(data: String): String {
    val norm = data.replace('\\', '/')
    val file = File(norm)
    val parent = file.parent ?: return ""
    val prefixes = listOf("/storage/emulated/0/", "/sdcard/", "/storage/sdcard0/")
    for (prefix in prefixes) {
      val idx = parent.lowercase().indexOf(prefix)
      if (idx >= 0) return parent.substring(idx + prefix.length).trim('/')
    }
    val storage = parent.indexOf("/storage/")
    if (storage >= 0) {
      val rest = parent.substring(storage + "/storage/".length)
      val slash = rest.indexOf('/')
      if (slash >= 0) return rest.substring(slash + 1).trim('/')
    }
    return File(parent).name
  }

  fun saveIndex(context: Context, videos: List<FoundVideo>) {
    val obj = JSONObject()
    for (video in videos) obj.put(video.id, video.path)
    File(context.filesDir, "media-index.json").writeText(obj.toString())
  }

  fun loadIndex(context: Context): MutableMap<String, Uri> {
    val file = File(context.filesDir, "media-index.json")
    val map = mutableMapOf<String, Uri>()
    if (!file.exists()) return map
    try {
      val obj = JSONObject(file.readText())
      val keys = obj.keys()
      while (keys.hasNext()) {
        val id = keys.next()
        map[id] = Uri.parse(obj.getString(id))
      }
    } catch (_: Exception) {
    }
    return map
  }
}
