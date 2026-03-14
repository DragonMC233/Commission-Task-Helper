from flask import Flask, request, send_file, jsonify, send_from_directory, abort
from PIL import Image # type: ignore
import json
import os
import re
import time
import unicodedata


app = Flask(__name__)
# 禁止 jsonify 对 key 进行字母排序，保留 index.json 中字段的原有顺序
app.json.sort_keys = False
# 基准目录：脚本所在目录，确保在 mac (SMB 挂载) 与 Windows 上都能找到同目录下的资源
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "index.json")
RECYCLE_FILE = os.path.join(BASE_DIR, "recyclebin.json")
RECYCLE_PIC_DIR = os.path.join(BASE_DIR, "recyclepic")
STAT_FILE = os.path.join(BASE_DIR, "Statistics.json")
PREVIEW_FILE = os.path.join(BASE_DIR, "BarView", "preview.json")

# 为提高可移植性：确保进程工作目录为脚本所在目录，并启用 UTF-8 行为
try:
    os.chdir(BASE_DIR)
except Exception:
    pass
# 在一些嵌入式/旧环境中，显式建议使用 UTF-8 以避免路径/IO 编码问题
os.environ.setdefault('PYTHONUTF8', '1')
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')


@app.after_request
def add_no_cache_headers(response):
    # 避免浏览器缓存 /load 与静态脚本，导致“已保存但刷新看不到”
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def _resolve_case_insensitive(base_dir: str, relative_path: str):
    """Resolve a path ignoring case per segment (helps on case-sensitive FS)."""
    parts = [p for p in relative_path.replace('\\', '/').split('/') if p not in ('', '.')]
    cur = base_dir
    for part in parts:
        try:
            entries = os.listdir(cur)
        except Exception:
            return None
        match = next((e for e in entries if e.lower() == part.lower()), None)
        if not match:
            return None
        cur = os.path.join(cur, match)
    return cur

# ✅ 加载 JSON
@app.route("/load", methods=["GET"])
def load_data():
    # 返回 index.json 的内容并附带 recyclebin（若存在）
    data = {}
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = {}

    # 尝试加载回收站数据并附加到响应中
    if os.path.exists(RECYCLE_FILE):
        try:
            with open(RECYCLE_FILE, 'r', encoding='utf-8') as f:
                recycle_data = json.load(f)
            data['recycleBin'] = recycle_data.get('tasks', recycle_data) if isinstance(recycle_data, dict) else recycle_data
        except Exception:
            data['recycleBin'] = []
    else:
        data['recycleBin'] = []

    # 统计文件（可选）
    if os.path.exists(STAT_FILE):
        try:
            with open(STAT_FILE, 'r', encoding='utf-8') as f:
                data['statistics'] = json.load(f)
        except Exception:
            data['statistics'] = {}
    else:
        data['statistics'] = {}

    return jsonify(data)


# ✅ 保存 JSON（不处理图片）
@app.route('/save', methods=['POST'])
def save():
    data = request.json

    # 读取旧 DB（若存在），用于在前端未显式提供 image 字段时保留旧引用
    old_db = {}
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                old_db = json.load(f)
        except Exception:
            old_db = {}

    # 合并逻辑：如果前端在 task 对象中没有提供 'image' 字段，则保留旧 DB 中的 image 引用
    old_images_by_id = {str(t.get('id')): t.get('image') for t in old_db.get('tasks', [])}

    merged_tasks = []
    for t in data.get('tasks', []):
        t_copy = dict(t)
        tid = str(t_copy.get('id'))
        # 区分前端显式设置 image 为 null/空 与 未提供 image 字段
        if 'image' not in t_copy:
            # 保留旧值（如果存在）
            if tid in old_images_by_id and old_images_by_id[tid]:
                t_copy['image'] = old_images_by_id[tid]
        # else: 前端显式提供（可能为 null），按前端意图保存
        merged_tasks.append(t_copy)

    data_to_save = dict(data)
    data_to_save['tasks'] = merged_tasks
    statistics_payload = data_to_save.pop('statistics', None)

    # 如果前端提供了 recycleBin 字段，则将其单独写入 recyclebin.json，并从 index 数据中移除
    recycle_payload = data_to_save.pop('recycleBin', None)
    if recycle_payload is not None:
        # normalize: ensure we write an object with tasks key for future compatibility
        recycle_to_write = {'tasks': recycle_payload} if not isinstance(recycle_payload, dict) or 'tasks' not in recycle_payload else recycle_payload
        recycle_tmp = RECYCLE_FILE + ".tmp"
        try:
            with open(recycle_tmp, 'w', encoding='utf-8') as rf:
                json.dump(recycle_to_write, rf, ensure_ascii=False, indent=2)
                rf.flush()
                os.fsync(rf.fileno())
            os.replace(recycle_tmp, RECYCLE_FILE)
        except Exception:
            try:
                if os.path.exists(recycle_tmp):
                    os.remove(recycle_tmp)
            except Exception:
                pass

    # ✅ 保存 index.json（已合并 image 字段） - 使用原子替换以避免并发写入损坏
    tmp_path = DB_FILE + ".tmp"
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data_to_save, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, DB_FILE)
    except Exception:
        # 清理临时文件（若存在），但不要抛出，以免影响前端
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

    # ✅ 单独保存统计数据（如果前端提供）
    if statistics_payload is not None:
        stats_tmp = STAT_FILE + ".tmp"
        try:
            with open(stats_tmp, 'w', encoding='utf-8') as sf:
                json.dump(statistics_payload, sf, ensure_ascii=False, indent=2)
                sf.flush()
                os.fsync(sf.fileno())
            os.replace(stats_tmp, STAT_FILE)
        except Exception:
            try:
                if os.path.exists(stats_tmp):
                    os.remove(stats_tmp)
            except Exception:
                pass

    # ✅ 清理未使用的图片（基于合并后的数据）
    cleanup_unused_images(data_to_save)

    return jsonify({"status": "ok"})


# ✅ 读取 BarView 快照（preview.json）
@app.route("/load-preview", methods=["GET"])
def load_preview():
    if os.path.exists(PREVIEW_FILE):
        try:
            with open(PREVIEW_FILE, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        except Exception:
            pass
    return jsonify({"currentId": None, "snapshots": []})


# ✅ 保存 BarView 快照（preview.json）
@app.route("/save-preview", methods=["POST", "GET"])
def save_preview():
    if request.method == "GET":
        raw = request.args.get("data")
        if not raw:
            return jsonify({"status": "error", "error": "missing_data"}), 400
        try:
            data = json.loads(raw)
        except Exception:
            return jsonify({"status": "error", "error": "invalid_json"}), 400
    else:
        data = request.json or {"currentId": None, "snapshots": []}

    tmp_path = PREVIEW_FILE + ".tmp"
    try:
        os.makedirs(os.path.dirname(PREVIEW_FILE), exist_ok=True)
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, PREVIEW_FILE)
        return jsonify({"status": "ok"})
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
    return jsonify({"status": "error"}), 500



# ✅ 首页
@app.route("/")
def serve_index():
    # 明确从脚本目录返回 index.html
    index_path = os.path.join(BASE_DIR, "MainView", "index.html")
    if os.path.exists(index_path):
        return send_file(index_path)
    return "", 404


# ✅ 静态文件
@app.route("/<path:path>")
def serve_static(path):
    # 从脚本目录提供静态文件，防止当前工作目录差异导致找不到文件
    # 阻止目录穿越
    safe_base = BASE_DIR
    # 规范化 URL 中的斜杠以适配不同平台
    requested = path.replace('/', os.sep)
    full_path = os.path.abspath(os.path.join(safe_base, requested))
    if not full_path.startswith(safe_base):
        abort(403)

    if os.path.exists(full_path) and os.path.isfile(full_path):
        # 直接返回文件，避免 send_from_directory 对路径分隔符的额外校验导致 404
        return send_file(full_path)

    # 在大小写敏感的文件系统上尝试忽略大小写解析（避免频繁新增挂载）
    resolved = _resolve_case_insensitive(safe_base, path)
    if resolved and os.path.isfile(resolved):
        return send_file(resolved)

    return "", 404


# 依赖统一静态路由 + 大小写无关解析，不再为单个目录专门挂载路由

def init_image_dimensions():
    """启动时检查 index.json，补全缺失的图片尺寸"""
    if not os.path.exists(DB_FILE):
        return

    try:
        updated = False
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if 'tasks' not in data:
            return

        for task in data['tasks']:
            image_path = task.get('image')
            # 如果有图片路径，但没有 w 或 h 字段
            if image_path and (task.get('w') is None or task.get('h') is None):
                # 兼容路径格式，确保能找到本地文件
                # 假设 image 存的是 "pic/xxx.png"，以脚本目录为基准构造路径
                full_path = os.path.join(BASE_DIR, image_path.replace('/', os.sep))
                
                if os.path.exists(full_path):
                    try:
                        with Image.open(full_path) as img:
                            task['w'], task['h'] = img.size
                            updated = True
                            print(f"✅ 已补全任务 [{task.get('name')}] 的尺寸: {img.size}")
                    except Exception as e:
                        print(f"❌ 无法读取图片 {full_path}: {e}")
                else:
                    print(f"⚠️ 找不到图片文件: {full_path}")

        # 如果数据有变动，写回文件（原子替换）
        if updated:
            tmp_path = DB_FILE + ".tmp"
            try:
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_path, DB_FILE)
                print("🚀 所有旧档图片的尺寸已补全并保存。")
            except Exception as e:
                print(f"写回旧档失败: {e}")
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except Exception:
                    pass
            
    except Exception as e:
        print(f"初始化检查失败: {e}")


# ✅ 图片上传（方案 B 的核心）
@app.route("/upload-image", methods=["POST"])
def upload_image():
    # 1. 检查文件字段名，注意：你原本的代码里用的是 "file"
    if "file" not in request.files:
        return jsonify({"status": "error", "error": "no_file"}), 400
        
    file = request.files["file"]
    task_name = request.form.get("taskName", "")
    task_id = request.form.get("taskId", "")

    # --- 保留你原本的获取任务名逻辑 ---
    if not task_name and task_id:
        try:
            if os.path.exists(DB_FILE):
                with open(DB_FILE, 'r', encoding='utf-8') as f:
                    db = json.load(f)
                    for t in db.get('tasks', []):
                        if str(t.get('id')) == str(task_id):
                            task_name = t.get('name', '')
                            break
        except Exception:
            pass

    # --- 保留你原本的文件名清洗逻辑 ---
    def sanitize_filename(name: str) -> str:
        if not name: return ""
        name = unicodedata.normalize('NFKC', name)
        name = name.strip()
        name = re.sub(r"\s+", "_", name)
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
        return name[:200]

    sanitized = sanitize_filename(task_name) or str(task_id)
    pic_dir = os.path.join(BASE_DIR, "pic")
    os.makedirs(pic_dir, exist_ok=True)

    # --- 保留你原本的带时间戳文件名生成逻辑 ---
    ts = int(time.time() * 1000)
    if "." in file.filename:
        ext = file.filename.rsplit(".", 1)[-1]
        filename = f"{task_id}_{ts}.{ext}" if sanitized == str(task_id) else f"{sanitized}_{task_id}_{ts}.{ext}"
    else:
        filename = f"{task_id}_{ts}"
        
    filepath = os.path.join(pic_dir, filename)
    file.save(filepath)

    # --- 【核心添加】获取图片尺寸 ---
    try:
        with Image.open(filepath) as img:
            width, height = img.size
    except Exception as e:
        print(f"读取图片尺寸失败: {e}")
        width, height = 0, 0

    # 返回新文件路径和宽高
    return jsonify({
        "path": f"pic/{filename}", 
        "w": width, 
        "h": height
    })


def _safe_move_image(src_rel: str, dst_dir: str, allowed_prefix: str):
    """Move image from src_rel (relative) to dst_dir, ensuring prefix safety."""
    if not src_rel:
        return None, "no_path"

    # 仅允许特定前缀的路径
    if not src_rel.startswith(allowed_prefix):
        return None, "invalid_path"

    basename = os.path.basename(src_rel)
    if not basename:
        return None, "invalid_basename"

    src_full = os.path.abspath(os.path.join(BASE_DIR, src_rel.replace('/', os.sep)))
    dst_dir_abs = os.path.abspath(dst_dir)
    os.makedirs(dst_dir_abs, exist_ok=True)
    dst_full = os.path.join(dst_dir_abs, basename)

    # 安全校验：源文件需位于 BASE_DIR 内，并且符合前缀目录
    allowed_base = os.path.abspath(os.path.join(BASE_DIR, allowed_prefix.split('/')[0]))
    if not src_full.startswith(allowed_base):
        return None, "invalid_source_root"

    if not os.path.exists(src_full):
        return None, "not_found"

    try:
        os.replace(src_full, dst_full)
        rel_path = os.path.relpath(dst_full, BASE_DIR).replace(os.sep, '/')
        return rel_path, None
    except Exception as e:  # noqa: BLE001
        return None, str(e)


@app.route('/move-image-to-recycle', methods=['POST'])
def move_image_to_recycle():
    data = request.get_json(force=True, silent=True) or {}
    path = data.get('path') or data.get('filename')
    new_path, err = _safe_move_image(path, RECYCLE_PIC_DIR, 'pic/')
    if err:
        status = 400 if err in {"invalid_path", "invalid_basename", "invalid_source_root"} else (404 if err == "not_found" else 500)
        return jsonify({"status": "error", "error": err, "newPath": path}), status
    return jsonify({"status": "ok", "moved": True, "newPath": new_path})


@app.route('/restore-image-from-recycle', methods=['POST'])
def restore_image_from_recycle():
    data = request.get_json(force=True, silent=True) or {}
    path = data.get('path') or data.get('filename')
    new_path, err = _safe_move_image(path, os.path.join(BASE_DIR, 'pic'), 'recyclepic/')
    if err:
        status = 400 if err in {"invalid_path", "invalid_basename", "invalid_source_root"} else (404 if err == "not_found" else 500)
        return jsonify({"status": "error", "error": err, "newPath": path}), status
    return jsonify({"status": "ok", "moved": True, "newPath": new_path})


def cleanup_unused_images(data):
    # 获取所有任务正在使用的图片路径（pic/ 与 recyclepic/ 均计入）
    used_images = set()
    for task in data.get("tasks", []):
        if 'image' in task and task.get('image'):
            img = task.get('image')
            if isinstance(img, str) and (img.startswith("pic/") or img.startswith("recyclepic/")):
                used_images.add(img)

    # 同时检查回收站中的任务，避免误删仅在回收站中引用的图片
    if os.path.exists(RECYCLE_FILE):
        try:
            with open(RECYCLE_FILE, 'r', encoding='utf-8') as rf:
                recycle = json.load(rf)
            for t in recycle.get('tasks', []) if isinstance(recycle, dict) else recycle:
                if 'image' in t and t.get('image'):
                    img = t.get('image')
                    if isinstance(img, str) and (img.startswith("pic/") or img.startswith("recyclepic/")):
                        used_images.add(img)
        except Exception:
            pass

    # 清理 pic 目录未使用的文件
    pic_dir = os.path.join(BASE_DIR, "pic")
    if os.path.isdir(pic_dir):
        for filename in os.listdir(pic_dir):
            path = f"pic/{filename}"
            if path not in used_images:
                try:
                    os.remove(os.path.join(pic_dir, filename))
                except Exception:
                    pass

    # 清理 recyclepic 目录未使用的文件
    recycle_dir = os.path.join(BASE_DIR, "recyclepic")
    if os.path.isdir(recycle_dir):
        for filename in os.listdir(recycle_dir):
            path = f"recyclepic/{filename}"
            if path not in used_images:
                try:
                    os.remove(os.path.join(recycle_dir, filename))
                except Exception:
                    pass


@app.route('/delete-image', methods=['POST'])
def delete_image():
    data = request.get_json(force=True, silent=True) or {}
    path = data.get('path') or data.get('filename')
    if not path:
        return jsonify({'status': 'error', 'error': 'no_path'}), 400

    # 只允许删除 pic 下的文件（基于脚本目录），使用 basename 防止目录穿越
    pic_dir = os.path.abspath(os.path.join(BASE_DIR, 'pic'))
    basename = os.path.basename(path)
    full_path = os.path.abspath(os.path.join(pic_dir, basename))
    if not full_path.startswith(pic_dir):
        return jsonify({'status': 'error', 'error': 'invalid_path'}), 400

    if not os.path.exists(full_path):
        return jsonify({'status': 'ok', 'deleted': False})

    # 检查该文件是否仍被 index.json 引用
    in_use = False
    try:
        if os.path.exists(DB_FILE):
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                db = json.load(f)
                for t in db.get('tasks', []):
                    img = t.get('image') or ''
                    if img and os.path.basename(img) == basename:
                        in_use = True
                        break
    except Exception:
        in_use = False

    if in_use:
        return jsonify({'status': 'in_use'}), 409

    try:
        os.remove(full_path)
        return jsonify({'status': 'ok', 'deleted': True})
    except Exception:
        return jsonify({'status': 'error', 'error': 'remove_failed'}), 500


def init_default_files():
    """启动时检查并初始化缺失的 JSON 数据文件，避免克隆后首次启动报错。"""
    # recyclebin.json：缺失时初始化为空回收站
    if not os.path.exists(RECYCLE_FILE):
        try:
            with open(RECYCLE_FILE, 'w', encoding='utf-8') as f:
                json.dump({"tasks": []}, f, ensure_ascii=False, indent=2)
            print(f"✅ 已自动创建 recyclebin.json（空回收站）")
        except Exception as e:
            print(f"⚠️ 创建 recyclebin.json 失败: {e}")

    # Statistics.json：缺失时初始化为空统计对象
    if not os.path.exists(STAT_FILE):
        try:
            with open(STAT_FILE, 'w', encoding='utf-8') as f:
                json.dump({"version": 1, "types": {}}, f, ensure_ascii=False, indent=2)
            print(f"✅ 已自动创建 Statistics.json（空统计数据）")
        except Exception as e:
            print(f"⚠️ 创建 Statistics.json 失败: {e}")


# ✅ 程序入口：所有路由和函数定义完成后才启动
if __name__ == "__main__":
    init_default_files()      # 启动时初始化缺失的数据文件
    init_image_dimensions()   # 启动时补全旧档图片的尺寸
    # 启动配置：可通过环境变量覆盖（便于在不同平台 / 容器中运行）
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 2233))
    debug = os.environ.get('DEBUG', 'false').lower() in ('1', 'true', 'yes')
    print(f"Starting server on {host}:{port} (debug={debug}) — BASE_DIR={BASE_DIR}")
    app.run(host=host, port=port, debug=debug)





