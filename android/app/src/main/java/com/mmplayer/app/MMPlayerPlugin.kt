package com.mmplayer.app

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Base64
import android.util.Size
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

@CapacitorPlugin(
  name = "MMPlayer",
  permissions = [
    Permission(alias = "videos", strings = [Manifest.permission.READ_MEDIA_VIDEO]),
    Permission(alias = "videosLegacy", strings = [Manifest.permission.READ_EXTERNAL_STORAGE])
  ]
)
class MMPlayerPlugin : Plugin() {
  private var server: MediaHttpServer? = null
  private var index: MutableMap<String, Uri> = mutableMapOf()

  override fun load() {
    try {
      index = VideoScanner.loadIndex(context)
      ensureServer()
    } catch (e: Exception) {
      index = mutableMapOf()
    }
  }

  private fun thumbsDir(): File {
    val dir = File(context.filesDir, "thumbs")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun thumbFile(id: String): File = File(thumbsDir(), "$id.jpg")

  private fun mediaUrl(kind: String, id: String): String {
    val port = server?.port ?: 0
    return "http://127.0.0.1:$port/$kind/$id"
  }

  private fun ensureServer() {
    if (server != null) return
    val http = MediaHttpServer(
      context,
      { id -> index[id] },
      { id -> thumbFile(id) }
    )
    http.start()
    server = http
  }

  private fun videoPermissionAlias(): String {
    return if (Build.VERSION.SDK_INT >= 33) "videos" else "videosLegacy"
  }

  @PluginMethod
  fun startServer(call: PluginCall) {
    ensureServer()
    val ret = JSObject()
    ret.put("port", server?.port ?: 0)
    call.resolve(ret)
  }

  @PluginMethod
  fun getInsets(call: PluginCall) {
    val act = activity
    if (act == null) {
      call.resolve(JSObject().put("top", 32).put("bottom", 0))
      return
    }
    act.runOnUiThread {
      try {
        val web = bridge.webView
        val density = context.resources.displayMetrics.density
        val insets = androidx.core.view.ViewCompat.getRootWindowInsets(web)
          ?: androidx.core.view.ViewCompat.getRootWindowInsets(act.window.decorView)
        val bars = insets?.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        val cut = insets?.getInsets(androidx.core.view.WindowInsetsCompat.Type.displayCutout())
        val statusPx = maxOf(bars?.top ?: 0, cut?.top ?: 0)
        val navPx = maxOf(bars?.bottom ?: 0, cut?.bottom ?: 0)
        val loc = IntArray(2)
        web.getLocationOnScreen(loc)
        val extraTop = maxOf(0, statusPx - loc[1])
        val screenH = context.resources.displayMetrics.heightPixels
        val extraBottom = if (loc[1] + web.height >= screenH - 4) navPx else 0
        val ret = JSObject()
        ret.put("top", extraTop / density)
        ret.put("bottom", extraBottom / density)
        ret.put("status", statusPx / density)
        ret.put("webTop", loc[1] / density)
        call.resolve(ret)
      } catch (e: Exception) {
        call.resolve(JSObject().put("top", 32).put("bottom", 0))
      }
    }
  }

  @PluginMethod
  fun getRoot(call: PluginCall) {
    val ret = JSObject()
    ret.put("uri", "media://all")
    ret.put("name", "저장소")
    call.resolve(ret)
  }

  @PluginMethod
  fun pickFolder(call: PluginCall) {
    val alias = videoPermissionAlias()
    if (getPermissionState(alias) != PermissionState.GRANTED) {
      requestPermissionForAlias(alias, call, "onReadPermission")
      return
    }
    openAllFilesIfNeeded(call)
  }

  @PermissionCallback
  private fun onReadPermission(call: PluginCall) {
    if (getPermissionState(videoPermissionAlias()) != PermissionState.GRANTED) {
      val ret = JSObject()
      ret.put("granted", false)
      call.resolve(ret)
      return
    }
    openAllFilesIfNeeded(call)
  }

  private fun openAllFilesIfNeeded(call: PluginCall) {
    if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
      val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
        data = Uri.parse("package:${context.packageName}")
      }
      startActivityForResult(call, intent, "onAllFiles")
      return
    }
    resolveAccess(call)
  }

  @ActivityCallback
  private fun onAllFiles(call: PluginCall, result: ActivityResult) {
    resolveAccess(call)
  }

  private fun resolveAccess(call: PluginCall) {
    prefs.edit().putString("treeUri", "media://all").apply()
    val ret = JSObject()
    ret.put("uri", "media://all")
    ret.put("granted", true)
    ret.put("name", "저장소")
    call.resolve(ret)
  }

  @PluginMethod
  fun scan(call: PluginCall) {
    thread {
      try {
        val videos = VideoScanner.scanAll(context) { found, dir ->
          val data = JSObject()
          data.put("walking", true)
          data.put("found", found)
          data.put("currentDir", dir)
          notifyListeners("scanProgress", data)
        }
        VideoScanner.saveIndex(context, videos)
        index = videos.associate { it.id to Uri.parse(it.path) }.toMutableMap()
        val arr = JSArray()
        for (video in videos) {
          val row = JSObject()
          row.put("id", video.id)
          row.put("path", video.path)
          row.put("name", video.name)
          row.put("ext", video.ext)
          row.put("size", video.size)
          row.put("mtime", video.mtime)
          row.put("diskFolder", video.diskFolder)
          if (video.duration != null) row.put("duration", video.duration)
          if (video.width != null) row.put("width", video.width)
          if (video.height != null) row.put("height", video.height)
          arr.put(row)
        }
        val ret = JSObject()
        ret.put("videos", arr)
        call.resolve(ret)
      } catch (e: Exception) {
        call.reject(e.message ?: "scan failed")
      }
    }
  }

  @PluginMethod
  fun hasThumb(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id")
    val file = thumbFile(id)
    val ret = JSObject()
    if (file.exists() && file.length() > 32) {
      ret.put("path", file.absolutePath)
      ret.put("url", mediaUrl("thumb", id))
    }
    call.resolve(ret)
  }

  @PluginMethod
  fun saveThumbFile(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id")
    val dataUrl = call.getString("dataUrl") ?: return call.reject("dataUrl")
    val comma = dataUrl.indexOf(',')
    val raw = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
    val bytes = Base64.decode(raw, Base64.DEFAULT)
    val file = thumbFile(id)
    FileOutputStream(file).use { it.write(bytes) }
    val ret = JSObject()
    ret.put("path", file.absolutePath)
    ret.put("url", mediaUrl("thumb", id))
    call.resolve(ret)
  }

  @PluginMethod
  fun captureThumb(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id")
    val uri = index[id] ?: return call.resolve(JSObject().put("ok", false))
    thread {
      var bitmap: Bitmap? = null
      val retriever = MediaMetadataRetriever()
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          try {
            bitmap = context.contentResolver.loadThumbnail(uri, Size(512, 288), null)
          } catch (_: Exception) {
          }
        }
        var durationMs = 0L
        var width: Int? = null
        var height: Int? = null
        try {
          retriever.setDataSource(context, uri)
          durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
          width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
          height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
          if (bitmap == null) {
            val timeUs = (durationMs * 1000L * 8 / 100).coerceAtLeast(400_000L)
            bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
              ?: retriever.frameAtTime
          }
        } catch (_: Exception) {
        }
        if (bitmap != null) {
          FileOutputStream(thumbFile(id)).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
          }
          bitmap.recycle()
        }
        val ret = JSObject()
        ret.put("ok", bitmap != null)
        if (bitmap != null) {
          ret.put("path", thumbFile(id).absolutePath)
          ret.put("url", mediaUrl("thumb", id))
        }
        if (durationMs > 0) ret.put("duration", durationMs / 1000.0)
        if (width != null) ret.put("width", width)
        if (height != null) ret.put("height", height)
        call.resolve(ret)
      } catch (_: Exception) {
        call.resolve(JSObject().put("ok", false))
      } finally {
        try {
          retriever.release()
        } catch (_: Exception) {
        }
      }
    }
  }

  @PluginMethod
  fun openExternal(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id")
    val uri = index[id] ?: return call.reject("없음")
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "video/*")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(Intent.createChooser(intent, "재생"))
    call.resolve()
  }

  @PluginMethod
  fun showInFolder(call: PluginCall) {
    openExternal(call)
  }

  @PluginMethod
  fun copyPath(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id")
    val uri = index[id] ?: return call.reject("없음")
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("path", uri.toString()))
    call.resolve()
  }

  private val prefs
    get() = context.getSharedPreferences("mmplayer", Context.MODE_PRIVATE)
}
