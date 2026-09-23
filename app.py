import os
import re
import subprocess
import tempfile
import html
import secrets
from pathlib import Path

import telebot
import requests


token = os.getenv("TOKEN", "").strip()
if not token:
    raise ValueError("Defina TOKEN no Railway")

bot = telebot.TeleBot(token, parse_mode="HTML")
data = {}
name = bot.get_me().username.lower()
emojis = ("😀", "😂", "😍", "😎", "🥳", "🤩", "😜", "🤖", "🔥", "✨", "💫", "🎉", "❤️", "👍", "👀", "🌟")


def usr(uid):
    if uid not in data:
        data[uid] = {"packs": [], "file": None, "mode": None, "intent": None, "src": None}
    return data[uid]


def drop(uid):
    old = usr(uid).get("file")
    if old:
        path = Path(old)
        path.unlink(missing_ok=True)
        path.parent.rmdir()
    usr(uid)["file"] = None
    usr(uid)["mode"] = None
    usr(uid)["src"] = None


def key(uid):
    packs = usr(uid)["packs"]
    rows = ["<h3>Figurinha pronta</h3><p>Onde você quer adicioná-la?</p>"]
    for i, pack in enumerate(packs):
        rows.append(f'<tg-button-row><tg-button type="callback_data" style="danger" data="p:{i}">{html.escape(pack["title"])}</tg-button></tg-button-row>')
    rows.append('<tg-button-row><tg-button type="callback_data" style="danger" data="p:other">Pacote existente</tg-button><tg-button type="callback_data" style="danger" data="p:new">Novo pacote</tg-button></tg-button-row>')
    return "".join(rows)


def clean(value):
    return re.sub(r"[^a-z0-9_]", "", value.lower())


def pack_id(value):
    value = value.strip()
    value = value.rsplit("/", 1)[-1]
    value = value.removeprefix("addstickers/")
    return clean(value)


def remember(uid, name_, title):
    packs = usr(uid)["packs"]
    packs[:] = [pack for pack in packs if pack["name"] != name_]
    packs.append({"name": name_, "title": title})


def known(uid, item):
    remember(uid, item.name, item.title)


def source(message):
    if message.photo:
        return message.photo[-1].file_id, "image"
    if message.video:
        return message.video.file_id, "video"
    if message.animation:
        return message.animation.file_id, "video"
    if message.document:
        mime = message.document.mime_type or ""
        if mime.startswith("image/"):
            return message.document.file_id, "image"
        if mime.startswith("video/"):
            return message.document.file_id, "video"
    return None, None


def actions(kind):
    rows = ["<h3>O que você quer fazer?</h3><p>Escolha uma opção.</p><tg-button-row>", '<tg-button type="callback_data" style="danger" data="a:s">Fazer figurinha</tg-button>']
    if kind == "video":
        rows.append('<tg-button type="callback_data" style="danger" data="a:a">Converter em áudio</tg-button>')
    rows.append("</tg-button-row>")
    return "".join(rows)


def rich(chat, body):
    res = requests.post(f"https://api.telegram.org/bot{token}/sendRichMessage", json={"chat_id": chat, "rich_message": {"html": body}}, timeout=30)
    out = res.json()
    if not res.ok or not out.get("ok"):
        raise RuntimeError(out.get("description", "Não consegui enviar a mensagem"))
    return out["result"]


def rich_edit(chat, mid, body):
    res = requests.post(f"https://api.telegram.org/bot{token}/editMessageText", json={"chat_id": chat, "message_id": mid, "rich_message": {"html": body}}, timeout=30)
    out = res.json()
    if not res.ok or not out.get("ok"):
        raise RuntimeError(out.get("description", "Não consegui atualizar a mensagem"))
    return out["result"]


def convert(file_id, kind):
    info = bot.get_file(file_id)
    raw = bot.download_file(info.file_path)
    root = Path(tempfile.mkdtemp())
    src = root / "in"
    out = root / "sticker.webm"
    src.write_bytes(raw)
    cmd = ["ffmpeg", "-y"]
    if kind == "image":
        cmd += ["-loop", "1"]
    cmd += ["-i", str(src), "-t", "3", "-vf", "crop='min(iw,ih)':'min(iw,ih)':'(iw-ow)/2':'(ih-oh)/2',scale=512:512:flags=lanczos,setsar=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(abs(X-255.5)/255.5\\,4)+pow(abs(Y-255.5)/255.5\\,4)\\,1)\\,255\\,0)'", "-r", "30", "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "44", "-deadline", "good", "-cpu-used", "4", str(out)]
    run = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    src.unlink()
    if run.returncode != 0 or not out.exists() or out.stat().st_size > 256000:
        out.unlink(missing_ok=True)
        root.rmdir()
        raise RuntimeError("Não foi possível gerar a figurinha")
    return out


def audio(file_id):
    info = bot.get_file(file_id)
    raw = bot.download_file(info.file_path)
    root = Path(tempfile.mkdtemp())
    src = root / "in"
    out = root / "audio.mp3"
    src.write_bytes(raw)
    check = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(src)], capture_output=True, text=True)
    if check.returncode != 0:
        raise RuntimeError("Não consegui ler a duração do vídeo")
    duration = float(check.stdout.strip())
    if duration > 120:
        raise RuntimeError("O vídeo precisa ter até 2 minutos")
    run = subprocess.run(["ffmpeg", "-y", "-i", str(src), "-vn", "-c:a", "libmp3lame", "-b:a", "192k", str(out)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    src.unlink()
    if run.returncode != 0 or not out.exists():
        raise RuntimeError("Não consegui extrair o áudio")
    return out


def add(uid, pack):
    item = usr(uid)
    with open(item["file"], "rb") as file:
        bot.add_sticker_to_set(uid, pack, secrets.choice(emojis), webm_sticker=file)
    drop(uid)
    return f"https://t.me/addstickers/{pack}"


def candidate(words, count):
    base = "_".join(clean(word) for word in words[:count] if clean(word))
    base = base[: max(1, 64 - len(name) - 4)]
    return f"{base}_by_{name}"


def exists(value):
    res = requests.post(f"https://api.telegram.org/bot{token}/getStickerSet", json={"name": value}, timeout=30)
    out = res.json()
    if out.get("ok"):
        return True
    if out.get("error_code") == 400 and "STICKERSET_INVALID" in out.get("description", ""):
        return False
    raise RuntimeError(out.get("description", "Não consegui verificar o nome do pacote"))


def create(uid, title):
    words = title.split()
    pack = candidate(words, 1)
    if exists(pack):
        if len(words) < 2:
            usr(uid)["mode"] = "word"
            return None
        pack = candidate(words, 2)
        if exists(pack):
            raise RuntimeError("Esse nome já existe. Use outro nome para o pacote.")
    item = usr(uid)
    with open(item["file"], "rb") as file:
        bot.create_new_sticker_set(uid, pack, title[:64], secrets.choice(emojis), webm_sticker=file)
    remember(uid, pack, title[:64])
    drop(uid)
    return f"https://t.me/addstickers/{pack}"


@bot.message_handler(commands=["start"])
def start(message):
    drop(message.from_user.id)
    usr(message.from_user.id)["intent"] = None
    rich(message.chat.id, "<h3>Envie uma mídia</h3><p><i>Imagem, GIF ou vídeo: eu pergunto o que você quer fazer.</i></p><p><code>/audio</code> converte diretamente um vídeo de até 2 minutos em áudio.</p>")


@bot.message_handler(commands=["audio"])
def ask_audio(message):
    uid = message.from_user.id
    drop(uid)
    usr(uid)["intent"] = "audio"
    rich(message.chat.id, "<h3>Conversão em áudio</h3><p>Envie um vídeo de até <b>2 minutos</b>.</p>")


@bot.message_handler(content_types=["photo", "video", "animation", "document"])
def media(message):
    file_id, kind = source(message)
    if not file_id:
        bot.send_message(message.chat.id, "Envie uma imagem, GIF ou vídeo.")
        return
    uid = message.from_user.id
    drop(uid)
    if usr(uid).get("intent") == "audio":
        usr(uid)["intent"] = None
        if kind != "video":
            bot.send_message(message.chat.id, "Envie um vídeo para converter em áudio.")
            return
        wait = bot.send_message(message.chat.id, "Extraindo áudio...")
        try:
            out = audio(file_id)
            with open(out, "rb") as file:
                bot.send_audio(message.chat.id, file)
            out.unlink(missing_ok=True)
            out.parent.rmdir()
            bot.delete_message(message.chat.id, wait.message_id)
        except Exception as error:
            text = str(error)
            bot.edit_message_text(text if text == "O vídeo precisa ter até 2 minutos" else "Não consegui converter esse vídeo.", message.chat.id, wait.message_id)
        return
    usr(uid)["src"] = (file_id, kind)
    rich(message.chat.id, actions(kind))


@bot.callback_query_handler(func=lambda call: call.data.startswith("a:"))
def action(call):
    uid = call.from_user.id
    src = usr(uid).get("src")
    bot.answer_callback_query(call.id)
    if not src:
        bot.send_message(call.message.chat.id, "Envie a mídia novamente.")
        return
    file_id, kind = src
    usr(uid)["src"] = None
    if call.data == "a:a":
        rich_edit(call.message.chat.id, call.message.message_id, "<p><i>Extraindo áudio...</i></p>")
        try:
            out = audio(file_id)
            with open(out, "rb") as file:
                bot.send_audio(call.message.chat.id, file)
            out.unlink(missing_ok=True)
            out.parent.rmdir()
            bot.delete_message(call.message.chat.id, call.message.message_id)
        except Exception as error:
            text = str(error)
            rich_edit(call.message.chat.id, call.message.message_id, f"<p>{html.escape(text if text == 'O vídeo precisa ter até 2 minutos' else 'Não consegui converter esse vídeo.')}</p>")
        return
    rich_edit(call.message.chat.id, call.message.message_id, "<p><i>Convertendo...</i></p>")
    try:
        out = convert(file_id, kind)
        usr(uid)["file"] = str(out)
        with open(out, "rb") as file:
            bot.send_sticker(call.message.chat.id, file)
        rich_edit(call.message.chat.id, call.message.message_id, key(uid))
    except Exception:
        drop(uid)
        rich_edit(call.message.chat.id, call.message.message_id, "<p>Não consegui converter esse arquivo.</p>")


@bot.callback_query_handler(func=lambda call: call.data.startswith("p:"))
def choose(call):
    uid = call.from_user.id
    value = call.data[2:]
    bot.answer_callback_query(call.id)
    if not usr(uid).get("file"):
        bot.send_message(call.message.chat.id, "Envie a mídia novamente.")
        return
    if value == "new":
        usr(uid)["mode"] = "new"
        rich(call.message.chat.id, "<h3>Novo pacote</h3><p>Envie o nome que você quer usar.</p>")
        return
    if value == "other":
        usr(uid)["mode"] = "other"
        rich(call.message.chat.id, "<h3>Pacote existente</h3><p>Envie o link ou o nome do pacote.</p>")
        return
    try:
        packs = usr(uid)["packs"]
        pack = packs[int(value)]["name"]
        link = add(uid, pack)
        bot.send_message(call.message.chat.id, f"Adicionada: {link}")
    except Exception:
        bot.send_message(call.message.chat.id, "Não consegui adicionar nesse pacote. Ele precisa permitir inclusão por este bot.")


@bot.message_handler(content_types=["text"])
def text(message):
    uid = message.from_user.id
    item = usr(uid)
    mode = item.get("mode")
    if not mode:
        bot.send_message(message.chat.id, "Envie uma imagem, GIF ou vídeo quadrado.")
        return
    if not item.get("file"):
        item["mode"] = None
        bot.send_message(message.chat.id, "Envie a mídia novamente.")
        return
    try:
        if mode == "other":
            pack = pack_id(message.text)
            set_ = bot.get_sticker_set(pack)
            known(uid, set_)
            link = add(uid, pack)
            bot.send_message(message.chat.id, f"Adicionada: {link}")
            return
        if mode == "word":
            title = item["title"] + " " + message.text.strip()
        else:
            title = message.text.strip()
        item["title"] = title
        link = create(uid, title)
        if not link:
            bot.send_message(message.chat.id, "A primeira palavra já existe. Envie apenas a segunda palavra:")
            return
        bot.send_message(message.chat.id, f"Pacote criado: {link}")
    except Exception:
        bot.send_message(message.chat.id, "Não consegui concluir agora.")


bot.infinity_polling(skip_pending=True, timeout=30, long_polling_timeout=30)
