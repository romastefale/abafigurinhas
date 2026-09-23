import html
import json
import logging
import os
import re
import secrets
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path

token = os.getenv("TOKEN", "").strip()
if not token:
    raise ValueError("Defina TOKEN no Railway")

url = f"https://api.telegram.org/bot{token}/"
file_url = f"https://api.telegram.org/file/bot{token}/"
log = logging.getLogger("app")
logging.basicConfig(level=logging.INFO)
data = {}
emojis = ("😀", "😂", "😍", "😎", "🥳", "🤩", "😜", "🤖", "🔥", "✨", "💫", "🎉", "❤️", "👍", "👀", "🌟")
volume = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
if not volume:
    raise RuntimeError("Conecte um Volume Railway montado em /data para salvar os pacotes")
db = sqlite3.connect(Path(volume) / "packs.sqlite3")
db.execute("CREATE TABLE IF NOT EXISTS packs (user_id INTEGER NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY (user_id, name))")
db.commit()


class Error(Exception):
    pass


def call(method, body=None, upload=None, timeout=35):
    body = body or {}
    try:
        if upload:
            field, path, mime = upload
            edge = uuid.uuid4().hex
            parts = []
            for key, value in body.items():
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False)
                parts.extend((f"--{edge}\r\n".encode(), f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(), str(value).encode(), b"\r\n"))
            parts.extend((f"--{edge}\r\n".encode(), f'Content-Disposition: form-data; name="{field}"; filename="{path.name}"\r\n'.encode(), f"Content-Type: {mime}\r\n\r\n".encode(), path.read_bytes(), b"\r\n", f"--{edge}--\r\n".encode()))
            req = urllib.request.Request(url + method, b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={edge}"})
        else:
            req = urllib.request.Request(url + method, json.dumps(body, ensure_ascii=False).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            out = json.loads(res.read())
    except urllib.error.HTTPError as error:
        try:
            out = json.loads(error.read())
        except json.JSONDecodeError:
            raise Error(str(error)) from error
        raise Error(out.get("description", str(error))) from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise Error(str(error)) from error
    if not out.get("ok"):
        raise Error(out.get("description", "Falha na operação"))
    return out["result"]


def user(uid):
    if uid not in data:
        packs = db.execute("SELECT name, title FROM packs WHERE user_id = ? ORDER BY rowid", (uid,)).fetchall()
        data[uid] = {"packs": [{"name": name, "title": title} for name, title in packs], "file": None, "mode": None, "intent": None, "src": None}
    return data[uid]


def discard(uid):
    value = user(uid)["file"]
    if value:
        path = Path(value)
        path.unlink()
        path.parent.rmdir()
    user(uid)["file"] = None
    user(uid)["mode"] = None
    user(uid)["src"] = None


def send(chat, body):
    return call("sendRichMessage", {"chat_id": chat, "rich_message": {"html": body}})


def edit(chat, mid, body):
    return call("editMessageText", {"chat_id": chat, "message_id": mid, "rich_message": {"html": body}})


def notice(chat, text):
    return send(chat, f"<p>{html.escape(text)}</p>")


def menu(uid):
    return '<h3>Figurinha pronta</h3><p>Onde você quer adicioná-la?</p><tg-button-row><tg-button type="callback_data" style="danger" data="p:other">Pacote existente</tg-button><tg-button type="callback_data" style="danger" data="p:new">Novo pacote</tg-button></tg-button-row>'


def pack_menu(uid):
    packs = user(uid)["packs"]
    rows = ["<h3>Escolha o pacote</h3>"]
    for i, pack in enumerate(packs):
        rows.append(f'<tg-button-row><tg-button type="callback_data" style="success" data="p:{i}">{html.escape(pack["title"])}</tg-button></tg-button-row>')
    if packs:
        rows.append('<tg-button-row><tg-button type="callback_data" style="danger" data="p:manual">Outro pacote</tg-button></tg-button-row>')
    else:
        rows.append("<p>Envie o link ou o nome do pacote existente.</p>")
    return "".join(rows)


def actions(kind):
    rows = ["<h3>O que você quer fazer?</h3><p>Escolha uma opção.</p><tg-button-row>", '<tg-button type="callback_data" style="danger" data="a:s">Fazer figurinha</tg-button>']
    if kind == "video":
        rows.append('<tg-button type="callback_data" style="danger" data="a:a">Converter em áudio</tg-button>')
    rows.append("</tg-button-row>")
    return "".join(rows)


def clean(value):
    return re.sub(r"[^a-z0-9_]", "", value.lower())


def pack_id(value):
    return clean(value.strip().rsplit("/", 1)[-1].removeprefix("addstickers/"))


def remember(uid, name, title):
    packs = user(uid)["packs"]
    packs[:] = [pack for pack in packs if pack["name"] != name]
    packs.append({"name": name, "title": title})
    db.execute("INSERT INTO packs (user_id, name, title) VALUES (?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET title = excluded.title", (uid, name, title))
    db.commit()


def media(message):
    if message.get("photo"):
        return message["photo"][-1]["file_id"], "image"
    if message.get("video"):
        return message["video"]["file_id"], "video"
    if message.get("animation"):
        return message["animation"]["file_id"], "video"
    item = message.get("document")
    if item and item.get("mime_type", "").startswith("image/"):
        return item["file_id"], "image"
    if item and item.get("mime_type", "").startswith("video/"):
        return item["file_id"], "video"
    raise Error("Envie uma imagem, GIF ou vídeo.")


def download(fid, root):
    item = call("getFile", {"file_id": fid})
    try:
        with urllib.request.urlopen(file_url + item["file_path"], timeout=35) as res:
            raw = res.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise Error(str(error)) from error
    src = root / "in"
    src.write_bytes(raw)
    return src


def sticker(fid, kind):
    root = Path(tempfile.mkdtemp())
    src = download(fid, root)
    out = root / "sticker.webm"
    cmd = ["ffmpeg", "-y"]
    if kind == "image":
        cmd += ["-loop", "1"]
    cmd += ["-i", str(src), "-t", "3", "-vf", "crop='min(iw,ih)':'min(iw,ih)':'(iw-ow)/2':'(ih-oh)/2',scale=512:512:flags=lanczos,setsar=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(abs(X-255.5)/255.5\\,4)+pow(abs(Y-255.5)/255.5\\,4)\\,1)\\,255\\,0)'", "-r", "30", "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "44", "-deadline", "good", "-cpu-used", "4", str(out)]
    run = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    src.unlink()
    if run.returncode != 0 or not out.exists() or out.stat().st_size > 256000:
        if out.exists():
            out.unlink()
        root.rmdir()
        raise Error("Não foi possível gerar a figurinha.")
    return out


def audio(fid):
    root = Path(tempfile.mkdtemp())
    src = download(fid, root)
    out = root / "audio.ogg"
    check = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(src)], capture_output=True, text=True)
    if check.returncode != 0:
        src.unlink()
        root.rmdir()
        raise Error("Não consegui ler a duração do vídeo.")
    if float(check.stdout.strip()) > 120:
        src.unlink()
        root.rmdir()
        raise Error("O vídeo precisa ter até 2 minutos.")
    run = subprocess.run(["ffmpeg", "-y", "-i", str(src), "-vn", "-c:a", "libopus", "-b:a", "96k", "-ac", "1", "-ar", "48000", "-application", "audio", "-f", "ogg", str(out)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    src.unlink()
    if run.returncode != 0 or not out.exists():
        if out.exists():
            out.unlink()
        root.rmdir()
        raise Error("Não consegui converter esse vídeo.")
    return out


def send_sticker(chat, path):
    return call("sendSticker", {"chat_id": chat}, ("sticker", path, "video/webm"))


def send_voice(chat, path):
    return call("sendVoice", {"chat_id": chat}, ("voice", path, "audio/ogg"))


def get_set(name):
    return call("getStickerSet", {"name": name})


def new_name(title, bot):
    words = title.split()
    first = clean(words[0]) if words else ""
    if not first or not first[0].isalpha():
        raise Error("O nome precisa começar com uma letra.")
    size = max(1, 64 - len(bot) - 4)
    name = f"{first[:size]}_by_{bot}"
    try:
        get_set(name)
    except Error as error:
        if "STICKERSET_INVALID" not in str(error):
            raise
        return name
    if len(words) < 2:
        return None
    base = "_".join(clean(word) for word in words[:2] if clean(word))[:size]
    name = f"{base}_by_{bot}"
    try:
        get_set(name)
    except Error as error:
        if "STICKERSET_INVALID" in str(error):
            return name
        raise
    raise Error("Esse nome já existe. Use outro nome para o pacote.")


def add(uid, name):
    path = Path(user(uid)["file"])
    item = {"sticker": "attach://sticker", "format": "video", "emoji_list": [secrets.choice(emojis)]}
    call("addStickerToSet", {"user_id": uid, "name": name, "sticker": item}, ("sticker", path, "video/webm"))
    discard(uid)
    return f"https://t.me/addstickers/{name}"


def create(uid, title, bot):
    name = new_name(title, bot)
    if not name:
        user(uid)["mode"] = "word"
        user(uid)["title"] = title
        return None
    path = Path(user(uid)["file"])
    item = {"sticker": "attach://sticker", "format": "video", "emoji_list": [secrets.choice(emojis)]}
    call("createNewStickerSet", {"user_id": uid, "name": name, "title": title[:64], "stickers": [item]}, ("sticker", path, "video/webm"))
    remember(uid, name, title[:64])
    discard(uid)
    return f"https://t.me/addstickers/{name}"


def start(message):
    uid = message["from"]["id"]
    discard(uid)
    user(uid)["intent"] = None
    send(message["chat"]["id"], "<h3>Envie uma mídia</h3><p><i>Imagem, GIF ou vídeo: eu pergunto o que você quer fazer.</i></p><p><code>/audio</code> converte diretamente um vídeo de até 2 minutos em áudio.</p>")


def ask_audio(message):
    uid = message["from"]["id"]
    discard(uid)
    user(uid)["intent"] = "audio"
    send(message["chat"]["id"], "<h3>Conversão em áudio</h3><p>Envie um vídeo de até <b>2 minutos</b>.</p>")


def receive_media(message):
    chat = message["chat"]["id"]
    uid = message["from"]["id"]
    fid, kind = media(message)
    discard(uid)
    if user(uid)["intent"] == "audio":
        user(uid)["intent"] = None
        if kind != "video":
            raise Error("Envie um vídeo para converter em áudio.")
        status = send(chat, "<p><i>Extraindo áudio...</i></p>")
        path = audio(fid)
        send_voice(chat, path)
        path.unlink()
        path.parent.rmdir()
        edit(chat, status["message_id"], "<p><b>Áudio pronto.</b></p>")
        return
    user(uid)["src"] = (fid, kind)
    send(chat, actions(kind))


def choose_action(query):
    uid = query["from"]["id"]
    message = query["message"]
    chat = message["chat"]["id"]
    mid = message["message_id"]
    call("answerCallbackQuery", {"callback_query_id": query["id"]})
    source = user(uid)["src"]
    if not source:
        raise Error("Envie a mídia novamente.")
    fid, kind = source
    user(uid)["src"] = None
    if query["data"] == "a:a":
        edit(chat, mid, "<p><i>Extraindo áudio...</i></p>")
        path = audio(fid)
        send_voice(chat, path)
        path.unlink()
        path.parent.rmdir()
        edit(chat, mid, "<p><b>Áudio pronto.</b></p>")
        return
    edit(chat, mid, "<p><i>Convertendo...</i></p>")
    path = sticker(fid, kind)
    user(uid)["file"] = str(path)
    send_sticker(chat, path)
    edit(chat, mid, menu(uid))


def choose_pack(query):
    uid = query["from"]["id"]
    message = query["message"]
    chat = message["chat"]["id"]
    value = query["data"][2:]
    call("answerCallbackQuery", {"callback_query_id": query["id"]})
    if not user(uid)["file"]:
        raise Error("Envie a mídia novamente.")
    if value == "new":
        user(uid)["mode"] = "new"
        edit(chat, message["message_id"], "<h3>Novo pacote</h3><p>Envie o nome que você quer usar.</p>")
        return
    if value == "other":
        packs = user(uid)["packs"]
        user(uid)["mode"] = "select" if packs else "other"
        edit(chat, message["message_id"], pack_menu(uid))
        return
    if value == "manual":
        user(uid)["mode"] = "other"
        edit(chat, message["message_id"], "<h3>Outro pacote</h3><p>Envie o link ou o nome do pacote.</p>")
        return
    packs = user(uid)["packs"]
    if not value.isdigit() or int(value) >= len(packs):
        raise Error("Envie a mídia novamente.")
    link = add(uid, packs[int(value)]["name"])
    notice(chat, f"Adicionada: {link}")


def receive_text(message, bot):
    chat = message["chat"]["id"]
    uid = message["from"]["id"]
    text = message.get("text", "").strip()
    if text.startswith("/start"):
        start(message)
        return
    if text.startswith("/audio"):
        ask_audio(message)
        return
    mode = user(uid)["mode"]
    if not mode:
        raise Error("Envie uma imagem, GIF ou vídeo.")
    if not user(uid)["file"]:
        raise Error("Envie a mídia novamente.")
    if mode == "select":
        if not text.isdigit() or int(text) >= len(user(uid)["packs"]):
            raise Error("Escolha um pacote nos botões da mensagem.")
        link = add(uid, user(uid)["packs"][int(text)]["name"])
        notice(chat, f"Adicionada: {link}")
        return
    if mode == "other":
        name = pack_id(text)
        if not name:
            raise Error("Envie o link ou o nome do pacote.")
        item = get_set(name)
        remember(uid, item["name"], item["title"])
        link = add(uid, name)
        notice(chat, f"Adicionada: {link}")
        return
    title = user(uid)["title"] + " " + text if mode == "word" else text
    link = create(uid, title, bot)
    if not link:
        notice(chat, "A primeira palavra já existe. Envie apenas a segunda palavra.")
        return
    notice(chat, f"Pacote criado: {link}")


def handle(update, bot):
    try:
        if "callback_query" in update:
            query = update["callback_query"]
            if query.get("data", "").startswith("a:"):
                choose_action(query)
            elif query.get("data", "").startswith("p:"):
                choose_pack(query)
            return
        message = update.get("message")
        if not message:
            return
        if "text" in message:
            receive_text(message, bot)
        else:
            receive_media(message)
    except Error as error:
        chat = update.get("callback_query", {}).get("message", {}).get("chat", {}).get("id") or update.get("message", {}).get("chat", {}).get("id")
        log.error("%s", error)
        if chat:
            notice(chat, str(error))
    except Exception:
        log.exception("Erro inesperado")
        chat = update.get("callback_query", {}).get("message", {}).get("chat", {}).get("id") or update.get("message", {}).get("chat", {}).get("id")
        if chat:
            notice(chat, "Não foi possível concluir agora.")


def main():
    bot = call("getMe")["username"].lower()
    call("deleteWebhook", {"drop_pending_updates": False})
    offset = None
    while True:
        body = {"timeout": 30, "allowed_updates": ["message", "callback_query"]}
        if offset is not None:
            body["offset"] = offset
        try:
            updates = call("getUpdates", body, timeout=40)
            for update in updates:
                offset = update["update_id"] + 1
                handle(update, bot)
        except Exception:
            log.exception("Falha no recebimento de atualizações")


if __name__ == "__main__":
    main()
