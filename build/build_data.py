#!/usr/bin/env python3
"""
Сборка статических данных словаря для en.avar.me.

Источники — av-en.jsonl / en-av.jsonl с sources.avar.me (скачиваются в build.sh).
Результат:

  dist/data/{av-en|en-av}/{index.words.txt,chunks/*.json,manifest.json,…}

Переменные окружения: DICTIONARY_JSONL, DOCS_ROOT, DICT_NAME.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

MAX_CHUNK_SIZE = 100 * 1024
MAX_WORDS_PER_CHUNK = 500

# repo/src/build_data.py → parents[1] = корень репозитория
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DICTIONARY = REPO_ROOT / "av-en.jsonl"
DEFAULT_DOCS = REPO_ROOT / "dist"


def normalize_word(word: str) -> str:
    import re

    normalized = word.lower().strip()
    # Согласовано с normalizeWord() в app.js (поиск и ключи чанков)
    normalized = re.sub(r"[1IiｌlL|!ǀӀІ]", "ӏ", normalized)
    return normalized


def _clean_comment_for_site(comment: str) -> str:
    """Убрать повторы в длинном комментарии словаря (много «буквально», «(на голове)» и т.д.).

    Парсер склеивает цепочку помет через «;» — на сайте показываем каждую уникальную
    часть один раз, порядок первого вхождения.
    """
    if not comment:
        return ""
    text = str(comment).replace("\n", " ").strip()
    if not text:
        return ""
    raw_parts = [p.strip() for p in text.split(";") if p.strip()]
    seen: set[str] = set()
    unique: list[str] = []
    for p in raw_parts:
        key = p.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return "; ".join(unique)


def _filter_display_labels(labels: list) -> list[str]:
    """Drop homonym service labels — number already in `homonym`."""
    out: list[str] = []
    for lab in labels:
        s = str(lab).strip()
        if not s:
            continue
        low = s.casefold().replace(" ", "")
        if low in ("омоним", "homonym") or (
            (low.startswith("омоним") and low[6:].isdigit())
            or (low.startswith("homonym") and low[7:].isdigit())
        ):
            continue
        if s not in out:
            out.append(s)
    return out


def _register_form_variants(form_to_word: dict[str, str], form: str, main_word: str) -> None:
    if not form:
        return
    if "/" in form:
        for variant in [x.strip() for x in form.split("/") if x.strip()]:
            form_to_word.setdefault(variant, main_word)
    else:
        form_to_word.setdefault(form, main_word)


def _see_also_refs(see_also: object) -> list[str]:
    if not see_also:
        return []
    out: list[str] = []
    for item in see_also:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            ref = item.get("target") or item.get("ref")
            if ref:
                out.append(str(ref))
    return out


def _relation_targets_norm(results: list[dict]) -> set[str]:
    """Нормализованные цели ссылок с грамматической пометой (мн. ч. от, масдар от, …)."""
    covered: set[str] = set()
    for r in results:
        for rel in r.get("relations") or []:
            t = (rel.get("target") or "").strip()
            if t:
                covered.add(normalize_word(t))
    return covered


def _filter_lookup_against_relations(lookup: list[str], results: list[dict]) -> list[str]:
    """Убрать из «см.» цели, уже показанные как relation с причиной."""
    covered = _relation_targets_norm(results)
    if not covered:
        return lookup
    out: list[str] = []
    for ref in lookup:
        if not ref:
            continue
        if normalize_word(str(ref)) in covered:
            continue
        if ref not in out:
            out.append(ref)
    return out


# Mapping of sense relation fields → English display labels
_RELATION_FIELDS: list[tuple[str, str]] = [
    ("masdarfrom",    "masdar of"),
    ("masdarforceto", "causative masdar of"),
    ("genitivefrom",  "genitive of"),
    ("pluralfor",     "plural of"),
    ("forceto",       "causative of"),
    ("participlefrom","participle of"),
    ("deverbfrom",    "deverbal of"),
    ("locativefrom",  "locative of"),
    ("dativefrom",    "dative of"),
    ("ergativefrom",  "ergative of"),
    ("casefrom",      "case of"),
    ("ablativefrom",  "ablative of"),
]


def _sense_to_result(
    sense: dict,
    entry_labels: list[str],
) -> dict:
    labels = _filter_display_labels(list(entry_labels))
    for lab in _filter_display_labels(sense.get("labels") or []):
        if lab not in labels:
            labels.append(lab)

    text = (sense.get("text") or "").strip()
    comment_raw = sense.get("comment")
    comment_clean = (
        _clean_comment_for_site(str(comment_raw).strip()) if comment_raw else ""
    )
    # Основной перевод — поле text; комментарий — отдельно (без склейки в одну «простыню»).
    if text:
        translation = text
        comment_out = comment_clean or None
    else:
        translation = comment_clean
        comment_out = None

    # precomment — помета перед переводом (курсив, мельче)
    precomment = (sense.get("precomment") or "").strip() or None

    examples_out: list[dict] = []
    for ex in sense.get("examples") or []:
        av = (ex.get("av") or "").strip()
        # av-en uses "en"; tolerate "ru" if a source still has it
        gloss = (ex.get("en") or ex.get("ru") or "").strip()
        note_parts: list[str] = []
        for lab in ex.get("labels") or []:
            if lab and str(lab).strip() and str(lab).strip() not in note_parts:
                note_parts.append(str(lab).strip())
        ex_comm = (ex.get("comment") or "").strip()
        if ex_comm and ex_comm not in note_parts:
            note_parts.append(ex_comm)
        if av or gloss or note_parts:
            item: dict = {"av": av, "en": gloss}
            if note_parts:
                item["note"] = "; ".join(note_parts)
            examples_out.append(item)

    # Relations: masdarfrom, genitivefrom, pluralfor, forceto, etc.
    relations_out: list[dict] = []
    for field, label in _RELATION_FIELDS:
        val = sense.get(field)
        if not val:
            continue
        target = str(val).strip()
        if target:
            relations_out.append({"kind": label, "target": target})

    sense_forms = sense.get("forms") or []
    out: dict = {
        "labels": labels,
        "translation": translation,
        "forms": [str(f).strip() for f in sense_forms if f and str(f).strip()],
        "examples": examples_out,
        "lookup": [],
    }
    if comment_out:
        out["comment"] = comment_out
    if precomment:
        out["precomment"] = precomment
    if relations_out:
        out["relations"] = relations_out
    return out


def _normalize_raw_entry(raw: dict) -> dict:
    """Upgrade simple en-av rows `{word,pos,avar}` to the rich sense schema."""
    if raw.get("senses") or raw.get("translations"):
        return raw
    avar = (raw.get("avar") or "").strip()
    if not avar:
        return raw
    word = (raw.get("word") or "").strip()
    pos = (raw.get("pos") or "").strip()
    sense: dict = {"text": avar}
    if pos:
        sense["labels"] = [pos]
    upgraded = {
        "word": word,
        "forms": [word] if word else [],
        "senses": [sense],
    }
    if pos:
        upgraded["pos"] = pos
    return upgraded


def convert_entry(raw: dict) -> dict:
    """One JSONL row → frontend entry format."""
    raw = _normalize_raw_entry(raw)
    word = (raw.get("word") or "").strip()
    forms = [str(f).strip() for f in (raw.get("forms") or []) if f and str(f).strip()]
    gender_forms = [
        str(f).strip() for f in (raw.get("gender_forms") or []) if f and str(f).strip()
    ]
    entry_labels = _filter_display_labels(list(raw.get("labels") or []))
    pos = (raw.get("pos") or "").strip()
    if pos and pos not in entry_labels:
        entry_labels = [pos] + entry_labels

    translations = raw.get("senses") or raw.get("translations") or []
    results: list[dict] = []
    for sense in translations:
        if not isinstance(sense, dict):
            continue
        results.append(_sense_to_result(sense, entry_labels))

    if not results:
        # Статья только со см. или пустые значения
        results.append(
            {
                "labels": entry_labels,
                "translation": "",
                "forms": [],
                "examples": [],
                "lookup": [],
            }
        )

    see = _filter_lookup_against_relations(
        _see_also_refs(raw.get("see_also")), results
    )
    if see:
        results[0]["lookup"] = see

    if forms and results:
        cur = list(results[0].get("forms") or [])
        merged_forms = list(forms)
        for x in cur:
            if x not in merged_forms:
                merged_forms.append(x)
        results[0]["forms"] = merged_forms
    forms_raw = raw.get("forms_raw")
    if forms_raw and results:
        fr = str(forms_raw).strip()
        if fr:
            cur = list(results[0].get("forms") or [])
            if fr not in cur:
                results[0]["forms"] = [fr] + cur

    parts = [word]
    if raw.get("word_raw"):
        parts.append(str(raw["word_raw"]))
    for s in translations:
        if isinstance(s, dict) and s.get("text"):
            parts.append(str(s["text"]))
    data = " ".join(parts)

    entry: dict = {
        "word": word,
        "forms": forms,
        "data": data,
        "results": results,
        "word_forms": raw.get("forms_raw"),
        "page": raw.get("page"),
    }
    # stress: позиция ударной гласной (1-based) или номер гласной в слове
    stress = raw.get("stress")
    if stress is not None:
        try:
            entry["stress"] = int(stress)
        except (TypeError, ValueError):
            pass
    # stem: основа слова
    stem = (raw.get("stem") or "").strip()
    if stem:
        entry["stem"] = stem
    # exclamation: восклицательная форма слова
    excl = (raw.get("exclamation") or "").strip()
    if excl:
        entry["exclamation"] = excl
    if gender_forms:
        entry["gender_forms"] = gender_forms
    return entry


def merge_site_entries(a: dict, b: dict) -> dict:
    """Объединить две статьи с одинаковым word (омонимы / фрагменты на одной странице)."""
    merged_results = (a.get("results") or []) + (b.get("results") or [])
    forms_out: list[str] = []
    seen: set[str] = set()
    for f in (a.get("forms") or []) + (b.get("forms") or []):
        if f and f not in seen:
            seen.add(f)
            forms_out.append(f)
    lookup_merged: list[str] = []
    for src in (a, b):
        r0 = (src.get("results") or [{}])[0]
        for x in r0.get("lookup") or []:
            if x and x not in lookup_merged:
                lookup_merged.append(x)
    out = {
        "word": a["word"],
        "forms": forms_out,
        "data": f"{a.get('data', '')} {b.get('data', '')}".strip(),
        "results": merged_results,
        "word_forms": a.get("word_forms") or b.get("word_forms"),
        "page": a.get("page"),
    }
    if out["results"]:
        lookup_merged = _filter_lookup_against_relations(lookup_merged, merged_results)
        out["results"][0]["lookup"] = lookup_merged
    gf_merged: list[str] = []
    for src in (a, b):
        for x in src.get("gender_forms") or []:
            if x and x not in gf_merged:
                gf_merged.append(x)
    if gf_merged:
        out["gender_forms"] = gf_merged
    for key in ("stress", "stem", "exclamation"):
        if a.get(key) is not None:
            out[key] = a[key]
        elif b.get(key) is not None:
            out[key] = b[key]
    return out


def load_dictionary(path: Path) -> tuple[dict[str, dict], dict[str, str]]:
    entries: dict[str, dict] = {}
    form_to_word: dict[str, str] = {}
    duplicates: dict[str, list[str]] = defaultdict(list)

    print(f"Чтение словаря: {path}")
    with open(path, encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  ОШИБКА JSON строка {line_num}: {e}", file=sys.stderr)
                continue
            conv = convert_entry(raw)
            w = conv["word"]
            if not w:
                continue
            if w in entries:
                duplicates[w].append(str(line_num))
                entries[w] = merge_site_entries(entries[w], conv)
                for form in conv.get("forms") or []:
                    _register_form_variants(form_to_word, form, w)
                for form in conv.get("gender_forms") or []:
                    _register_form_variants(form_to_word, form, w)
            else:
                entries[w] = conv
                for form in conv.get("forms") or []:
                    _register_form_variants(form_to_word, form, w)
                for form in conv.get("gender_forms") or []:
                    _register_form_variants(form_to_word, form, w)

    # Форма может быть и отдельной статьёй (род. пад. от, омоним) — не перекрывать lemma.
    stripped = [f for f in form_to_word if f in entries]
    for form in stripped:
        del form_to_word[form]
    if stripped:
        print(f"  Форм→lemma: пропущено {len(stripped)} (есть своя статья)")

    if duplicates:
        print(f"  Объединено дубликатов word: {len(duplicates)}")
    return entries, form_to_word


def create_index(entries: dict[str, dict]) -> list[str]:
    all_words: set[str] = set(entries.keys())
    for word, entry in entries.items():
        for form in (entry.get("forms") or []) + (entry.get("gender_forms") or []):
            if form and form.strip():
                fs = form.strip()
                if "/" in fs:
                    for variant in [v.strip() for v in fs.split("/") if v.strip()]:
                        all_words.add(variant)
                else:
                    all_words.add(fs)
    words = sorted(all_words)
    print(f"Уникальных заглавных слов: {len(entries)}")
    print(f"Строк в индексе (слова + формы): {len(words)}")
    return words


def get_prefix(word: str, length: int = 2) -> str:
    normalized = normalize_word(word)
    return normalized[: min(length, len(normalized))]


def split_into_chunks(
    entries: dict[str, dict],
    words: list[str],
    form_to_word_map: dict[str, str],
) -> dict[str, dict]:
    chunks: dict[str, dict] = defaultdict(dict)
    prefix_groups: dict[str, list[str]] = defaultdict(list)
    for word in words:
        prefix_groups[get_prefix(word, 2)].append(word)

    print(f"Групп по 2-символьному префиксу: {len(prefix_groups)}")
    for prefix, prefix_words in sorted(prefix_groups.items()):
        group_data: dict[str, dict] = {}
        for w in prefix_words:
            if w in entries:
                group_data[w] = entries[w]
            elif w in form_to_word_map:
                main_word = form_to_word_map[w]
                if main_word in entries:
                    group_data[w] = entries[main_word]
        group_json = json.dumps(group_data, ensure_ascii=False)
        group_size = len(group_json.encode("utf-8"))

        if group_size > MAX_CHUNK_SIZE or len(prefix_words) > MAX_WORDS_PER_CHUNK:
            print(f"  {prefix}: {len(prefix_words)} слов, {group_size} байт — дробим на 3 символа")
            sub_groups: dict[str, list[str]] = defaultdict(list)
            for word in prefix_words:
                sub_groups[get_prefix(word, 3)].append(word)
            for sub_prefix, sub_words in sorted(sub_groups.items()):
                chunk_name = sub_prefix if sub_prefix else prefix
                chunk_data: dict[str, dict] = {}
                for w in sub_words:
                    if w in entries:
                        chunk_data[w] = entries[w]
                    elif w in form_to_word_map:
                        mw = form_to_word_map[w]
                        if mw in entries:
                            chunk_data[w] = entries[mw]
                chunks[chunk_name] = chunk_data
                cj = json.dumps(chunks[chunk_name], ensure_ascii=False)
                print(f"    {chunk_name}: {len(sub_words)} слов, {len(cj.encode('utf-8'))} байт")
        else:
            chunks[prefix] = group_data
            print(f"  {prefix}: {len(prefix_words)} слов, {group_size} байт")
    return chunks


def write_index(words: list[str], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    index_file = output_dir / "index.words.txt"
    with open(index_file, "w", encoding="utf-8") as f:
        for word in words:
            f.write(word + "\n")
    print(f"Индекс: {index_file} ({len(words)} строк)")


def write_headwords_index(entries: dict[str, dict], output_dir: Path) -> int:
    """Только заглавные слова — для листинга по префиксу (как на avar.me)."""
    headwords = sorted(entries.keys())
    path = output_dir / "index.headwords.txt"
    with open(path, "w", encoding="utf-8") as f:
        for word in headwords:
            f.write(word + "\n")
    print(f"Индекс заглавных: {path} ({len(headwords)} строк)")
    return len(headwords)


def _entry_gloss(entry: dict, max_senses: int = 3) -> str:
    parts: list[str] = []
    for r in entry.get("results") or []:
        t = (r.get("translation") or "").strip()
        if t and t not in parts:
            parts.append(t)
        if len(parts) >= max_senses:
            break
    return "; ".join(parts)


def write_form_to_headword(form_map: dict[str, str], output_dir: Path) -> None:
    """Форма / родовая форма → заглавное слово (для поиска по префиксу)."""
    compact = {k: v for k, v in form_map.items() if k and v and k != v}
    path = output_dir / "form_to_headword.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = path.stat().st_size // 1024
    print(f"Form→headword: {path} ({len(compact)} записей, ~{size_kb} KB)")


def write_browse(entries: dict[str, dict], output_dir: Path) -> None:
    """Краткие глоссы и формы для главной и таблицы по префиксу."""
    browse: dict[str, dict] = {}
    for word, entry in entries.items():
        gloss = _entry_gloss(entry)
        forms = [str(f).strip() for f in (entry.get("forms") or []) if f and str(f).strip()][:8]
        if gloss or forms:
            browse[word] = {"g": gloss, "forms": forms}
    path = output_dir / "browse.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(browse, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = path.stat().st_size // 1024
    print(f"Browse: {path} ({len(browse)} статей, ~{size_kb} KB)")


def _safe_chunk_filename(prefix: str) -> str:
    """Префикс может содержать / (напр. из слова «б/ачӀ…») — недопустимо в имени файла."""
    s = prefix.replace("/", "_").replace("\\", "_").replace(":", "_")
    s = s.strip("._") or "_"
    return s


def write_chunks(chunks: dict[str, dict], output_dir: Path) -> list[dict]:
    chunks_dir = output_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    chunk_info: list[dict] = []
    for chunk_name, chunk_data in sorted(chunks.items()):
        safe = _safe_chunk_filename(chunk_name)
        chunk_file = chunks_dir / f"{safe}.json"
        with open(chunk_file, "w", encoding="utf-8") as f:
            json.dump(chunk_data, f, ensure_ascii=False, indent=2)
        file_size = chunk_file.stat().st_size
        with open(chunk_file, "rb") as f:
            file_hash = hashlib.md5(f.read()).hexdigest()[:8]
        chunk_info.append(
            {
                "prefix": chunk_name,
                "file": f"{safe}.json",
                "words_count": len(chunk_data),
                "size": file_size,
                "hash": file_hash,
            }
        )
    print(f"Чанков: {len(chunks)} в {chunks_dir}")
    return chunk_info


def write_manifest(
    words: list[str],
    chunk_info: list[dict],
    output_dir: Path,
    headwords_count: int,
) -> None:
    chunk_fingerprint = hashlib.md5(
        "".join(c["hash"] for c in chunk_info).encode("utf-8")
    ).hexdigest()[:12]
    manifest = {
        "version": "3.5.0",
        "source": "dictionary.jsonl",
        "build_date": __import__("datetime").datetime.now().isoformat(),
        "build_id": chunk_fingerprint,
        "total_words": len(words),
        "headwords_count": headwords_count,
        "total_chunks": len(chunk_info),
        "chunks": chunk_info,
    }
    manifest_file = output_dir / "manifest.json"
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest: {manifest_file}")


def build_dictionary(dictionary_path: Path, output_dir: Path, dict_name: str) -> bool:
    print("=" * 60)
    print(f"Build {dict_name} → {output_dir}")
    print("=" * 60)
    entries, form_map = load_dictionary(dictionary_path)
    if not entries:
        print("No entries.", file=sys.stderr)
        return False
    words = create_index(entries)
    chunks = split_into_chunks(entries, words, form_map)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_index(words, output_dir)
    headwords_count = write_headwords_index(entries, output_dir)
    write_form_to_headword(form_map, output_dir)
    write_browse(entries, output_dir)
    chunk_info = write_chunks(chunks, output_dir)
    write_manifest(words, chunk_info, output_dir, headwords_count)
    return True


def main() -> None:
    dict_path = Path(os.environ.get("DICTIONARY_JSONL", DEFAULT_DICTIONARY)).resolve()
    if not dict_path.is_file():
        print(f"File not found: {dict_path}", file=sys.stderr)
        sys.exit(1)

    docs_root = Path(os.environ.get("DOCS_ROOT", DEFAULT_DOCS)).resolve()
    dict_name = os.environ.get("DICT_NAME", "av-en")
    out = docs_root / "data" / dict_name
    if not build_dictionary(dict_path, out, dict_name):
        sys.exit(1)
    print(f"\nDone: {docs_root}/data/{dict_name}")


if __name__ == "__main__":
    main()
