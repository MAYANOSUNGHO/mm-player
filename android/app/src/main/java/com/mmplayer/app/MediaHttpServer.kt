package com.mmplayer.app

import android.content.Context
import android.net.Uri
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Locale

class MediaHttpServer(
  private val context: Context,
  private val lookup: (id: String) -> Uri?,
  private val thumbFile: (id: String) -> File
) {
  private var serverSocket: ServerSocket? = null
  var port: Int = 0
    private set

  fun start() {
    if (serverSocket != null) return
    val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    serverSocket = socket
    port = socket.localPort
    Thread({
      while (true) {
        val client = try {
          serverSocket?.accept()
        } catch (_: Exception) {
          break
        } ?: break
        Thread({ serve(client) }, "mm-media-req").apply { isDaemon = true }.start()
      }
    }, "mm-media").apply { isDaemon = true }.start()
  }

  fun stop() {
    try {
      serverSocket?.close()
    } catch (_: Exception) {
    }
    serverSocket = null
  }

  private fun serve(socket: Socket) {
    try {
      socket.soTimeout = 30_000
      val input = socket.getInputStream().buffered()
      val requestLine = readLine(input) ?: return
      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val method = parts[0].uppercase(Locale.US)
      val path = parts[1].substringBefore("?")
      val headers = HashMap<String, String>()
      while (true) {
        val line = readLine(input) ?: break
        if (line.isEmpty()) break
        val idx = line.indexOf(':')
        if (idx > 0) headers[line.substring(0, idx).trim().lowercase(Locale.US)] = line.substring(idx + 1).trim()
      }

      val out = BufferedOutputStream(socket.getOutputStream())
      if (method == "OPTIONS") {
        writeHeaders(out, 204, mapOf(), 0)
        out.flush()
        return
      }
      if (method != "GET" && method != "HEAD") {
        writeHeaders(out, 405, mapOf("Content-Type" to "text/plain"), 0)
        out.flush()
        return
      }

      val segments = path.split("/").filter { it.isNotEmpty() }
      if (segments.size != 2 || (segments[0] != "video" && segments[0] != "thumb")) {
        writeHeaders(out, 404, mapOf("Content-Type" to "text/plain"), 0)
        out.flush()
        return
      }
      val id = segments[1]
      if (segments[0] == "thumb") {
        sendFile(out, thumbFile(id), "image/jpeg", method == "HEAD", headers["range"])
        return
      }
      val uri = lookup(id)
      if (uri == null) {
        writeHeaders(out, 404, mapOf("Content-Type" to "text/plain"), 0)
        out.flush()
        return
      }
      sendUri(out, uri, method == "HEAD", headers["range"])
    } catch (_: Exception) {
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun sendFile(
    out: BufferedOutputStream,
    file: File,
    mime: String,
    head: Boolean,
    rangeHeader: String?
  ) {
    if (!file.exists()) {
      writeHeaders(out, 404, mapOf("Content-Type" to "text/plain"), 0)
      out.flush()
      return
    }
    sendBytes(out, file.length(), mime, head, rangeHeader) { start, _ ->
      FileInputStream(file).also { it.channel.position(start) }
    }
  }

  private fun sendUri(out: BufferedOutputStream, uri: Uri, head: Boolean, rangeHeader: String?) {
    val afd = context.contentResolver.openAssetFileDescriptor(uri, "r")
    if (afd == null) {
      writeHeaders(out, 404, mapOf("Content-Type" to "text/plain"), 0)
      out.flush()
      return
    }
    try {
      val size = afd.length.coerceAtLeast(0)
      val name = uri.lastPathSegment ?: "video.mp4"
      sendBytes(out, size, VideoIds.mimeFor(name), head, rangeHeader) { start, _ ->
        val stream = FileInputStream(afd.fileDescriptor)
        if (start > 0) {
          try {
            stream.channel.position(start)
          } catch (_: Exception) {
            var skipped = 0L
            while (skipped < start) {
              val n = stream.skip(start - skipped)
              if (n <= 0) break
              skipped += n
            }
          }
        }
        stream
      }
    } finally {
      try {
        afd.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun sendBytes(
    out: BufferedOutputStream,
    size: Long,
    mime: String,
    head: Boolean,
    rangeHeader: String?,
    open: (start: Long, end: Long) -> FileInputStream
  ) {
    val range = parseRange(rangeHeader, size)
    if (range == null) {
      writeHeaders(out, 416, mapOf("Content-Type" to mime, "Content-Range" to "bytes */$size"), 0)
      out.flush()
      return
    }
    val start = range.first
    val end = range.second
    val length = if (size == 0L) 0 else end - start + 1
    val status = if (rangeHeader.isNullOrBlank()) 200 else 206
    val headers = mutableMapOf(
      "Content-Type" to mime,
      "Accept-Ranges" to "bytes",
      "Content-Length" to length.toString(),
      "Cache-Control" to "no-store"
    )
    if (status == 206) headers["Content-Range"] = "bytes $start-$end/$size"
    writeHeaders(out, status, headers, length)
    if (head || length == 0L) {
      out.flush()
      return
    }
    open(start, end).use { input ->
      val buf = ByteArray(64 * 1024)
      var left = length
      while (left > 0) {
        val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
        if (n <= 0) break
        out.write(buf, 0, n)
        left -= n
      }
      out.flush()
    }
  }

  private fun parseRange(header: String?, size: Long): Pair<Long, Long>? {
    if (header.isNullOrBlank()) return 0L to (size - 1).coerceAtLeast(0)
    val match = Regex("^bytes=(\\d*)-(\\d*)\$", RegexOption.IGNORE_CASE).find(header.trim()) ?: return null
    val a = match.groupValues[1]
    val b = match.groupValues[2]
    if (a.isEmpty() && b.isEmpty()) return null
    if (a.isEmpty()) {
      val suffix = b.toLongOrNull() ?: return null
      if (suffix <= 0) return null
      return (size - suffix).coerceAtLeast(0) to (size - 1).coerceAtLeast(0)
    }
    val start = a.toLongOrNull() ?: return null
    val end = if (b.isEmpty()) size - 1 else minOf(b.toLongOrNull() ?: return null, size - 1)
    if (start < 0 || start >= size || end < start) return null
    return start to end
  }

  private fun writeHeaders(out: BufferedOutputStream, status: Int, extra: Map<String, String>, length: Long) {
    val text = when (status) {
      200 -> "OK"
      204 -> "No Content"
      206 -> "Partial Content"
      404 -> "Not Found"
      405 -> "Method Not Allowed"
      416 -> "Range Not Satisfiable"
      else -> "OK"
    }
    val sb = StringBuilder()
    sb.append("HTTP/1.1 $status $text\r\n")
    sb.append("Access-Control-Allow-Origin: *\r\n")
    sb.append("Access-Control-Allow-Methods: GET,HEAD,OPTIONS\r\n")
    sb.append("Access-Control-Allow-Headers: Range\r\n")
    sb.append("Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range, Content-Type\r\n")
    extra.forEach { (k, v) -> sb.append("$k: $v\r\n") }
    if (!extra.containsKey("Content-Length")) sb.append("Content-Length: $length\r\n")
    sb.append("Connection: close\r\n\r\n")
    out.write(sb.toString().toByteArray(Charsets.US_ASCII))
  }

  private fun readLine(input: java.io.InputStream): String? {
    val sb = StringBuilder()
    while (true) {
      val c = input.read()
      if (c == -1) return if (sb.isEmpty()) null else sb.toString()
      if (c == '\n'.code) break
      if (c != '\r'.code) sb.append(c.toChar())
    }
    return sb.toString()
  }
}
