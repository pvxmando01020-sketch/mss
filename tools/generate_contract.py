#!/usr/bin/env python3
"""Generate the MSS technical contract (عقد فني) as a formatted, RTL Word document.

Usage: python3 tools/generate_contract.py
Output: docs/technical-contract.docx
"""
from __future__ import annotations

import os
from docx import Document
from docx.shared import Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

NAVY = RGBColor(0x1F, 0x38, 0x64)
BLUE = RGBColor(0x2E, 0x5B, 0x9F)
GREY = RGBColor(0x59, 0x59, 0x59)
BLACK = RGBColor(0x22, 0x22, 0x22)
AR_FONT = "Arial"
MONO = "Consolas"


def set_run_font(run, name: str = AR_FONT, size: float = 11, bold: bool = False,
                 color: RGBColor | None = None, italic: bool = False):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), name)


def rtl(paragraph):
    """Mark paragraph as right-to-left (complex script)."""
    ppr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement("w:bidi")
    bidi.set(qn("w:val"), "true")
    pstyle = ppr.find(qn("w:pStyle"))
    if pstyle is not None:
        pstyle.addnext(bidi)
    else:
        ppr.insert(0, bidi)


def para(doc, text="", size=11, bold=False, color=None, align=WD_ALIGN_PARAGRAPH.RIGHT,
         space_after=6, space_before=0, font=AR_FONT):
    p = doc.add_paragraph()
    rtl(p)
    p.alignment = align
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.25
    if text:
        r = p.add_run(text)
        set_run_font(r, name=font, size=size, bold=bold, color=color or BLACK)
    return p


def h1(doc, text):
    p = doc.add_heading(level=1)
    r = p.add_run(text)
    set_run_font(r, size=18, bold=True, color=NAVY)
    rtl(p)
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(8)
    return p


def h2(doc, text):
    p = doc.add_heading(level=2)
    r = p.add_run(text)
    set_run_font(r, size=14, bold=True, color=BLUE)
    rtl(p)
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    return p


def bullet(doc, text, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    rtl(p)
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(2)
    if bold_prefix:
        r = p.add_run(bold_prefix)
        set_run_font(r, bold=True)
    r = p.add_run(text)
    set_run_font(r)
    return p


def numbered(doc, n, text):
    p = doc.add_paragraph()
    rtl(p)
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.right_indent = Mm(6)
    r = p.add_run(f"{n}. ")
    set_run_font(r, bold=True, color=NAVY)
    r = p.add_run(text)
    set_run_font(r)
    return p


def code_block(doc, text: str, size=8.5):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.1
    ppr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "F3F4F6")
    ppr.insert(0, shd)
    r = p.add_run(text)
    set_run_font(r, name=MONO, size=size, color=RGBColor(0x1F, 0x29, 0x37))
    return p


def shade_cell(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def table(doc, headers, rows, widths_mm=None, mono_cols=()):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    tblpr = t._tbl.tblPr
    tblpr.append(OxmlElement("w:bidiVisual"))
    for i, htext in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        rtl(p)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r = p.add_run(htext)
        set_run_font(r, size=10, bold=True, color=NAVY)
        shade_cell(cell, "D9E2F3")
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            rtl(p)
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT if i in mono_cols else WD_ALIGN_PARAGRAPH.RIGHT
            r = p.add_run(str(val))
            set_run_font(r, name=MONO if i in mono_cols else AR_FONT, size=9.5)
    if widths_mm:
        for row in t.rows:
            for i, w in enumerate(widths_mm):
                row.cells[i].width = Mm(w)
    para(doc, "", size=6, space_after=2)
    return t


def add_toc_field(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    f1 = OxmlElement("w:fldChar"); f1.set(qn("w:fldCharType"), "begin")
    it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve")
    it.text = 'TOC \\o "1-3" \\h \\z \\u'
    f2 = OxmlElement("w:fldChar"); f2.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = "جدول المحتويات — بعد فتح المستند: انقر هنا واختر «تحديث الحقول» لتوليد المحتويات."
    f3 = OxmlElement("w:fldChar"); f3.set(qn("w:fldCharType"), "end")
    for el in (f1, it, f2, t, f3):
        run._r.append(el)


def add_page_number(paragraph):
    run = paragraph.add_run()
    for tag, attrs, text in (
        ("w:fldChar", {"w:fldCharType": "begin"}, None),
        ("w:instrText", {"xml:space": "preserve"}, " PAGE "),
        ("w:fldChar", {"w:fldCharType": "end"}, None),
    ):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        if text:
            el.text = text
        run._r.append(el)
    set_run_font(run, size=9, color=GREY)


def main():
    doc = Document()
    core = doc.core_properties
    core.title = "العقد الفني — تطبيق دردشة ذكي متعدد النماذج"
    core.author = "الفريق التقني — MSS"
    core.subject = "Technical Contract — Multi-Model AI Chat"

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(18)
    sec.top_margin = sec.bottom_margin = Mm(16)

    normal = doc.styles["Normal"]
    normal.font.name = AR_FONT
    normal.font.size = Pt(11)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), AR_FONT)
    lang = OxmlElement("w:lang"); lang.set(qn("w:val"), "ar-EG")
    rpr.append(lang)

    header_p = sec.header.paragraphs[0]
    header_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hr = header_p.add_run("العقد الفني — تطبيق الدردشة الذكي متعدد النماذج (MSS)  |  الإصدار 1.0")
    set_run_font(hr, size=8, color=GREY)
    footer_p = sec.footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_page_number(footer_p)

    # ---------- Cover ----------
    for _ in range(5):
        para(doc, "", space_after=12)
    para(doc, "تطبيق الدردشة الذكي متعدد النماذج", size=30, bold=True, color=NAVY,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)
    para(doc, "Multi-Model AI Chat Application", size=14, color=GREY,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=24)
    para(doc, "العقد الفني للتنفيذ", size=20, bold=True, color=BLUE,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=36)
    table(doc,
          ["الحقل", "القيمة"],
          [["كود المشروع", "MSS"],
           ["إصدار المستند", "1.0"],
           ["التاريخ", "16 سبتمبر 2026"],
           ["إعداد", "الفريق التقني"],
           ["الجمهور المستهدف", "المطوّرون، المعماريون، فريق الجودة، DevOps"],
           ["التصنيف", "داخلي — سري"]],
          widths_mm=[50, 110])
    doc.add_page_break()

    # ---------- Revision history + TOC ----------
    h1(doc, "سجل الإصدارات")
    table(doc, ["الإصدار", "التاريخ", "الوصف", "المسؤول"],
          [["1.0", "2026-09-16", "الإصدار الأول من العقد الفني", "الفريق التقني"]],
          widths_mm=[20, 32, 80, 28])
    h1(doc, "جدول المحتويات")
    add_toc_field(doc)
    doc.add_page_break()

    # ---------- 1. نظرة عامة ----------
    h1(doc, "1. نظرة عامة على المستند")
    h2(doc, "1.1 الغرض")
    para(doc, "يُعد هذا العقد المرجع الفني الرسمي لتصميم وتطوير واختبار «تطبيق الدردشة الذكي متعدد "
              "النماذج»، وهو ملزم لجميع الفرق التقنية (تطوير، جودة، عمليات). أي انحراف عنه يتطلب "
              "تعديلاً مكتوباً معتمداً من رئيس الفريق التقني.")
    h2(doc, "1.2 النطاق")
    para(doc, "يغطي العقد: الواجهة الأمامية (Web)، بوابة الـ API الموحدة (Backend)، طبقة البيانات، "
              "التصفية والأمان، تكامل نماذج الذكاء الاصطناعي، تجربة الاستخدام، وخارطة الطريق المرحلية "
              "مع معايير القبول لكل مرحلة.")
    h2(doc, "1.3 ما هو خارج النطاق في الـ MVP")
    bullet(doc, "الذاكرة السياقية طويلة المدى (RAG) — مرحلة 3.")
    bullet(doc, "الوكلاء متعدّدو الأدوار ولوحة التحليلات — مرحلة 3.")
    bullet(doc, "تطبيق الموبايل (Flutter) — يُنفَّذ لاحقاً على نفس عقد الـ API.")
    bullet(doc, "الاختيار التلقائي الذكي (Classifier) — مرحلة 3.")

    # ---------- 2. الهدف ----------
    h1(doc, "2. نظرة عامة على المشروع وأهدافه")
    para(doc, "بناء تطبيق دردشة موحّد يدعم عدة نماذج لغة (OpenAI، Claude، وأخرى لاحقاً) عبر نقطة نهاية "
              "داخلية واحدة (API Gateway)، بحيث لا تتعامل الواجهة مع أي مزوّد مباشرة.")
    para(doc, "الأهداف التقنية:", bold=True, space_before=4)
    numbered(doc, 1, "إخفاء جميع مزوّدي النماذج خلف بوابة موحدة بعقد واحد ثابت.")
    numbered(doc, 2, "بثّ الردود لحظة بلحظة (Streaming عبر SSE) — لا انتظار صامت.")
    numbered(doc, 3, "اختيار يدوي للنموذج + وضع «تلقائي» قائم على قواعد (افتراضي).")
    numbered(doc, 4, "دعم RTL كامل للعربية بجانب الإنجليزية، مع وضعي Dark/Light.")
    numbered(doc, 5, "تحكم كامل في التكلفة والاختراقات: حدود استخدام، حدود طول، إعادة محاولة ونموذج بديل (Fallback).")
    numbered(doc, 6, "إضافة نموذج جديد = سطر واحد في سجلّ الإعدادات، بدون كتابة كود جديد (Adapter Pattern).")

    # ---------- 3. العمارة ----------
    h1(doc, "3. العمارة التقنية")
    h2(doc, "3.1 المخطط العام")
    code_block(doc,
        "[Browser] ──HTTPS──▶ [Next.js UI] ──SSE──▶ [Fastify API Gateway]\n"
        "                                              │  validation · security · rate limit\n"
        "                                              │  routing · retry · fallback\n"
        "                      ┌──────────────────────┼──────────────────────┐\n"
        "                      ▼                      ▼                      ▼\n"
        "               [OpenAI Adapter]      [Claude Adapter]      [Mock / future adapters]\n"
        "                                              │\n"
        "                 ┌────────────┬──────────────┴──────┬────────────┐\n"
        "                 ▼            ▼                     ▼            ▼\n"
        "          [PostgreSQL]   [Redis]              [S3 Storage]  [pgvector *]\n"
        "\n"
        "* يُضاف في المرحلة 3 فقط (RAG).")
    h2(doc, "3.2 المكونات")
    table(doc, ["المكوّن", "التقنية", "المسؤولية"],
          [["واجهة الويب", "Next.js + TypeScript + Tailwind", "نافذة المحادثة، السجل الجانبي، البث، RTL، Dark/Light"],
           ["بوابة الـ API", "Node.js/TypeScript + Fastify", "عقد موحد، تحقق صارم (Zod)، أمان، توجيه، إعادة محاولة/بديل"],
           ["قاعدة البيانات", "PostgreSQL 16+", "المستخدمون، المحادثات، الرسائل (metadata)"],
           ["الوسيط", "Redis 7+", "الجلسات، الكاش، عدادات حدود الاستخدام"],
           ["تخزين الكائنات", "S3-compatible (MinIO محلياً)", "المرفقات بصيغة مفاتيح منظمة"],
           ["قاعدة متجهية", "pgvector (المرحلة 3)", "الذاكرة السياقية RAG — لاحقاً فقط"]],
          widths_mm=[34, 56, 70])
    h2(doc, "3.3 تدفق طلب المحادثة")
    numbered(doc, 1, "الواجهة ترسل POST /v1/chat إلى البوابة (نص، مرفقات اختيارية، اختيار النموذج).")
    numbered(doc, 2, "البوابة تحقّق الطلب بمخطط Zod صارم وتطبّع الترميز وتزيل أي HTML/Scripts.")
    numbered(doc, 3, "فحص الاعتدال: أنماط حقن معروفة + نقطة اعتدال رخيصة (اختياري قبل الإرسال).")
    numbered(doc, 4, "تطبيق حدود الاستخدام (Rate Limit) والحدود الطولية/التوكنز.")
    numbered(doc, 5, "اختيار النموذج (يدوي أو قاعدة التوجيه) وإدارة السياق (اقتطاع/تلخيص عند الاقتراب من الحد).")
    numbered(doc, 6, "استدعاء المحوّل (Adapter) الخاص بالمزوّد مع بثّ SSE متدرّج للواجهة.")
    numbered(doc, 7, "عند الفشل: إعادة محاولة بتأخير تصاعدي ثم نموذج بديل، ورمز خطأ موحّد للواجهة.")
    numbered(doc, 8, "حفظ الرسالة النهائية (المحتوى، النموذج، عدد التوكنز، الوقت) في PostgreSQL.")
    h2(doc, "3.4 مبادئ التوسّع")
    bullet(doc, "البوابة stateless وتعمل أفقياً خلف Load Balancer.")
    bullet(doc, "المهام الثقيلة غير المتزامنة (تحليل ملفات كبير) تذهب لطابور مهام (BullMQ/Redis) عند الحاجة — ليست في الـ MVP.")
    bullet(doc, "عقد الـ API ثابت؛ الواجهات (Web/موبايل) تتعامل مع العقد فقط لا مع المزوّدين.")

    # ---------- 4. Frontend ----------
    h1(doc, "4. الواجهة الأمامية")
    h2(doc, "4.1 التقنيات")
    para(doc, "Next.js (App Router) + TypeScript + Tailwind CSS. إدارة الحالة محلياً (Zustand/Context) مع "
              "حالة الخادم للمحادثات. خيار الموبايل لاحقاً: Flutter على نفس عقد الـ API.")
    h2(doc, "4.2 المكونات الأساسية")
    table(doc, ["المكوّن", "الوصف", "المتطلبات"],
          [["سجل المحادثات الجانبي", "قائمة المحادثات، إنشاء، حذف", "تحديث فوري عند الإرسال الأول"],
           ["فقاعات الرسائل", "نص + شارة النموذج + إعادة توليد", "شارة واضحة لأي نموذج أجاب"],
           ["محدد النموذج", "قائمة النماذج المتاحة + «تلقائي»", "الافتراضي: تلقائي"],
           ["شريط الإدخال", "نص + إرفاق + إرسال + إيقاف التوليد", "الإيقاف = AbortController فوري"],
           ["الإعدادات", "مفاتيح API (BYO-Key) مستقبلاً، اللغة، المظهر", "المفاتيح أبداً لا تُخزَّن محلياً"],
           ["الشريط العلوي", "تبديل Dark/Light، تبديل RTL/LTR", "الحالة محفوظة في localStorage"]],
          widths_mm=[40, 62, 58])
    h2(doc, "4.3 إدارة البث (Streaming)")
    bullet(doc, "استهلاك SSE عبر fetch + ReadableStream (يدعم POST بخلاف EventSource).")
    bullet(doc, "زر الإيقاف يقطع الاتصال فوراً (AbortController) وتُحفظ الجزئية المُرسَلة.")
    bullet(doc, "لا انتظار صامت: يجب ظهور أول حرف خلال ثانيتين، وإلا يظهر مؤشر حالة واضح.")
    h2(doc, "4.4 RTL وإتاحة الاستخدام")
    bullet(doc, "دعم RTL كامل للعربية مع خاصيات CSS المنطقية (margin-inline, padding-start…).")
    bullet(doc, "تباين لوني ≥ 4.5:1، وحجم خط أساسي 14–16pt.")
    bullet(doc, "تخصيص الخط العربي (Arial/Tahoma) مع دعم أكواد LTR داخل RTL (code blocks).")

    # ---------- 5. Backend ----------
    h1(doc, "5. الواجهة الخلفية وعقد الـ API")
    h2(doc, "5.1 التقنيات")
    para(doc, "Node.js 22 + TypeScript + Fastify 5. التحقق من كل طلب بمخططات Zod. تسجيل مهيكل (pino) "
              "مع Request ID لكل طلب.")
    h2(doc, "5.2 نقاط النهاية")
    table(doc, ["الطريقة", "المسار", "الوصف"],
          [["GET", "/v1/health", "فحص الصحة (200 + الحالة)"],
           ["GET", "/v1/models", "قائمة النماذج المتاحة وقدراتها وحدود سياقها"],
           ["POST", "/v1/chat", "المحادثة مع بث SSE (النقطة الأساسية)"],
           ["POST", "/v1/conversations", "إنشاء محادثة {title, model, systemPrompt}"],
           ["GET", "/v1/conversations", "قائمة محادثات المستخدم"],
           ["GET", "/v1/conversations/{id}", "تفاصيل المحادثة + رسائلها"],
           ["DELETE", "/v1/conversations/{id}", "حذف المحادثة ورسائلها"]],
          widths_mm=[22, 52, 86], mono_cols=(1,))
    h2(doc, "5.3 طلب POST /v1/chat")
    code_block(doc,
        'POST /v1/chat\n'
        '{\n'
        '  "conversationId": "uuid | null",\n'
        '  "model": "auto | openai:gpt-4o-mini | anthropic:claude-3-5-haiku",\n'
        '  "systemPrompt": "اختياري — لكل محادثة",\n'
        '  "messages": [\n'
        '    { "role": "user", "content": "اكتب دالة TypeScript…",\n'
        '      "attachments": [ { "type": "image", "dataUrl": "data:image/png;base64,…" } ] }\n'
        '  ]\n'
        '}')
    h2(doc, "5.4 أحداث SSE")
    table(doc, ["الحدث", "المحمول (payload)", "ملاحظة"],
          [["start", "{conversationId, model, fallbackFrom?, warnings?}", "يُرسل فور بدء التوليد"],
           ["delta", "{text}", "قطع نصي متدرج (حرف/كلمة)"],
           ["usage", "{inputTokens, outputTokens, model}", "تقديري في MVP، دقيق من المزوّد إن توفر"],
           ["done", "{stopReason}", "نهاية طبيعية"],
           ["fallback", "{from, to, reason}", "عند التحويل لنموذج بديل"],
           ["error", "{code, message}", "رمز موحّد — لا أخطاء مزوّد خام"]],
          widths_mm=[28, 78, 54], mono_cols=(0, 1))
    h2(doc, "5.5 رموز الأخطاء الموحدة")
    table(doc, ["الرمز", "HTTP", "المعنى", "الإجراء المقترح بالواجهة"],
          [["INVALID_INPUT", "400", "فشل التحقق أو تجاوز حدود الطول", "عرض سبب واضح للمستخدم"],
           ["MODERATION_FLAGGED", "451", "محتوى مخالف (حقن/اعتدال)", "تحذير، ولا يُرسل أي رد نموذج"],
           ["RATE_LIMITED", "429", "تجاوز حد الاستخدام", "عرض retry-after بالدقائق"],
           ["CONTEXT_TOO_LONG", "413", "السياق يتجاوز حد النموذج بعد الاقتطاع", "طلب تقصير المحادثة"],
           ["MODEL_UNAVAILABLE", "503", "المزوّد غير متاح / مفتاح غير مهيأ", "اقتراح نموذج آخر"],
           ["UPSTREAM_ERROR", "502", "فشل المزوّد بعد إعادة المحاولة والبديل", "زر إعادة المحاولة"],
           ["NOT_FOUND", "404", "محادثة غير موجودة", "تحديث القائمة"],
           ["INTERNAL", "500", "خطأ غير متوقع", "تسجيل + إشعار عام"]],
          widths_mm=[44, 18, 56, 42], mono_cols=(0, 1))
    h2(doc, "5.6 إدارة الأخطاء وإعادة المحاولة")
    bullet(doc, "إعادة محاولة تلقائية: محاولتان كحد أقصى مع تأخير تصاعدي (0.3ث → 1.2ث) على الأخطاء 429/5xx/Timeout.")
    bullet(doc, "بعد نفاد المحاولات: التحويل للنموذج البديل المحدد في السجل (Fallback) وإبلاغ الواجهة بحادث fallback.")
    bullet(doc, "الواجهة لا ترى أبداً أخطاء المزوّد الخام — رموز موحدة فقط مع رسائل مقروءة بالعربية/الإنجليزية.")

    # ---------- 6. Data ----------
    h1(doc, "6. طبقة البيانات")
    h2(doc, "6.1 مخطط PostgreSQL")
    code_block(doc,
        "CREATE TABLE users (\n"
        "  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n"
        "  email       CITEXT UNIQUE NOT NULL,\n"
        "  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()\n"
        ");\n"
        "\n"
        "CREATE TABLE conversations (\n"
        "  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n"
        "  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n"
        "  title          TEXT NOT NULL DEFAULT 'محادثة جديدة',\n"
        "  model          TEXT NOT NULL DEFAULT 'auto',\n"
        "  system_prompt  TEXT,\n"
        "  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),\n"
        "  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()\n"
        ");\n"
        "\n"
        "CREATE TABLE messages (\n"
        "  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n"
        "  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,\n"
        "  role             TEXT NOT NULL CHECK (role IN ('system','user','assistant')),\n"
        "  content          JSONB NOT NULL,\n"
        "  model            TEXT,\n"
        "  tokens           INTEGER,\n"
        "  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()\n"
        ");\n"
        "CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at);")
    h2(doc, "6.2 استخدام Redis")
    bullet(doc, "الجلسات والمصادقة (عند تفعيل الحسابات).")
    bullet(doc, "عدادات حدود الاستخدام: INCR + EXPIRE لكل مفتاح مستخدم (دقيقي/يومي).")
    bullet(doc, "كاش معلومات النماذج ونتائج الاعتدال السريع.")
    h2(doc, "6.3 تخزين المرفقات (S3)")
    bullet(doc, "مفتاح المخزن: attachments/{userId}/{messageId}/{filename}.")
    bullet(doc, "الحد الأقصى 10MB، الأنواع المسموحة: png, jpg, webp, pdf, txt.")
    bullet(doc, "التحقق من نوع الملف بالمحتوى (Magic Bytes) على الخادم، وروابط Multipart مؤقتة للقراءة.")
    h2(doc, "6.4 قاعدة البيانات المتجهية (المرحلة 3)")
    para(doc, "pgvector داخل PostgreSQL نفسه + عمليات Embedding للذاكرة السياقية طويلة المدى (RAG). "
              "لا تُضاف إلا عند ظهور الحاجة الفعلية لتقليل التكلفة والتعقيد.")

    # ---------- 7. Security ----------
    h1(doc, "7. تصفية البيانات والأمان")
    h2(doc, "7.1 تنظيف المدخلات")
    numbered(doc, 1, "إزالة أي HTML/Script وسوم غير نصية قبل المعالجة.")
    numbered(doc, 2, "تطبيع الترميز (Unicode NFKC) وإزالة الرموز الضارة (Control Characters).")
    numbered(doc, 3, "تحقق صارم بمخطط Zod لكل نوع طلب (أدوار، أطوال، أنواع المرفقات).")
    h2(doc, "7.2 كشف الحقن (Prompt Injection)")
    bullet(doc, "فحص أولي بقائمة أنماط معروفة (إنجليزي/عربي): أوامر تجاهل التعليمات، كشف الـ system prompt، أنماط Jailbreak الشائعة.")
    bullet(doc, "استدعاء نقطة اعتدال محتوى رخيصة قبل إرسال الطلب للنموذج (اختياري حسب البيئة).")
    bullet(doc, "السلوك: وضع «صارم» = رفض (MODERATION_FLAGGED)؛ الوضع الافتراضي = تحذير مرئي داخل الحدث start مع مواصلة الطلب.")
    h2(doc, "7.3 حدود الطول والتوكنز")
    table(doc, ["الحد", "القيمة", "ملاحظة"],
          [["أقصى طول رسالة واحدة", "32,000 حرف", "فوقه INVALID_INPUT"],
           ["أقصى عدد رسائل في الطلب", "60", "مع اقتطاع تلقائي حسب سياق النموذج"],
           ["أقصى عدد مرفقات", "4 لكل رسالة", "صور PNG/JPG/WEBP"],
           ["أقصى حجم مرفق", "10MB", "على مستوى الخادم"],
           ["ميزانية السياق", "80% من حد النموذج", "الاقتطاع من الأقدم للأحدث"]],
          widths_mm=[50, 40, 70])
    h2(doc, "7.4 أسرار ومفاتيح API")
    para(doc, "مفاتيح المزوّدين تبقى في الباك إند فقط (متغيرات بيئة/مدير أسرار) ولا تصل للواجهة أو أي "
              "كود عميل إطلاقاً. دعم BYO-Key لاحقاً يتطلب تخزيناً مشفراً على مستوى الخادم.")
    h2(doc, "7.5 حدود الاستخدام (Rate Limiting)")
    table(doc, ["الحد", "القيمة الافتراضية", "التخزين"],
          [["طلبات / دقيقة", "60", "Redis (INCR+EXPIRE) — ذاكرة مؤقتة في MVP"],
           ["رسائل / يوم", "2,000", "Redis"],
           ["الحجم الكلي للمدفوعات", "1MB", "تفادى إساءة الاستخدام"]],
          widths_mm=[50, 44, 66])
    h2(doc, "7.6 الشبكة والتشفير")
    bullet(doc, "HTTPS إلزامي في كل البيئات + HSTS.")
    bullet(doc, "CORS بقائمة بيض صارمة (نطاقات الواجهة المعتمدة فقط).")
    bullet(doc, "عناوين أمان: CSP صارمة، X-Content-Type-Options: nosniff.")
    bullet(doc, "إخفاء معلومات الإصدار والأخطاء الخام عن الخارج.")

    # ---------- 8. Models ----------
    h1(doc, "8. تكامل النماذج الذكية")
    h2(doc, "8.1 طبقة التجريد الموحد (Adapter Pattern)")
    para(doc, "كل مزوّد له محوّل بواجهة موحدة: تدخل مصفوفة رسائل قياسية وتخرج Stream بأحداث موحدة.")
    code_block(doc,
        "interface ModelAdapter {\n"
        "  readonly id: string;\n"
        "  stream(req: {\n"
        "    system?: string;\n"
        "    messages: UnifiedMessage[];\n"
        "  }, signal: AbortSignal): AsyncGenerator<AdapterEvent>;\n"
        "}\n"
        "\n"
        "type AdapterEvent =\n"
        "  | { kind: 'delta'; text: string }\n"
        "  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number }; stopReason: string }\n"
        "  | { kind: 'error'; code: ErrorCode; message: string; retryable: boolean };")
    h2(doc, "8.2 سجل النماذج (إعدادات — ليست كوداً)")
    para(doc, "إضافة نموذج جديد = سطر جديد في هذا السجل (+ محوّل فقط إذا كان المزوّد جديداً تماماً). "
              "الواجهة لا تتغير إطلاقاً.")
    table(doc, ["معرّف النموذج", "المزوّد", "سياق", "القدرات", "البديل"],
          [["gpt-4o-mini", "OpenAI", "128k", "نص · رؤية · كود", "claude-3-5-haiku"],
           ["claude-3-5-haiku", "Anthropic", "200k", "نص · كود", "gpt-4o-mini"],
           ["(المرحلة 2) نموذج رؤية متقدم", "—", "—", "رؤية", "—"],
           ["(المرحلة 2) نموذج كود متقدم", "—", "—", "كود", "—"]],
          widths_mm=[44, 26, 16, 40, 34], mono_cols=(0,))
    h2(doc, "8.3 التوجيه (Routing) — قواعد بسيطة في الـ MVP")
    numbered(doc, 1, "اختيار المستخدم اليدوي يعلو على كل القواعد.")
    numbered(doc, 2, "الطلب يحتوي صورة → نموذج قادر على الرؤية (Vision).")
    numbered(doc, 3, "النص يطلب كوداً (قائمة كلمات مفتاحية + أنماط) → نموذج الكود.")
    numbered(doc, 4, "أي طلب آخر → النموذج العام الأرخص (توفير تكلفة).")
    para(doc, "الاختيار التلقائي الذكي (Classifier مستقل) مؤجّل للمرحلة 3 عمداً.")
    h2(doc, "8.4 إدارة السياق")
    bullet(doc, "كل محادثة = مصفوفة {الدور، المحتوى، النموذج المستخدم، الوقت، عدد التوكنز}.")
    bullet(doc, "تقدير التوكنز محلياً (الحروف ÷ 4) في الـ MVP، ويُستبدل بعدّاد المزوّد عند توفّره.")
    bullet(doc, "عند تجاوز 80% من ميزانية السياق: اقتطاع الرسائل الأقدم للأحدث؛ التلخيص الآلي يُضاف لاحقاً.")
    bullet(doc, "System Prompt منفصل وقابل للتخصيص لكل محادثة، ويُحمى من الاستبدال عبر الحقن.")

    # ---------- 9. UX ----------
    h1(doc, "9. تصميم تجربة الاستخدام (UX/UI)")
    h2(doc, "9.1 قواعد صارمة")
    bullet(doc, "البث تدريجي إلزامي — أي استجابة تُعرض حرفاً حرفاً.")
    bullet(doc, "شارة واضحة تبيّن أي نموذج أجاب على كل رسالة (خاصة مع الوضع التلقائي).")
    bullet(doc, "RTL كامل للعربية بجانب الإنجليزية، وتبديل فوري للغة الواجهة.")
    bullet(doc, "Dark/Light مع احترام إعداد النظام كافتراضي وحفظ التفضيل.")
    h2(doc, "9.2 حالات الأخطاء والفاصل")
    bullet(doc, "رسائل خطأ موحدة مقروءة (عربي/إنجليزي) مع زر «إعادة المحاولة».")
    bullet(doc, "حالة الترحيب عند المحادثة الفارغة مع اقتراحات جاهزة.")
    bullet(doc, "عند الإيقاف: تبقى الجزئية المولّدة مع علامة «تم الإيقاف».")

    # ---------- 10. Roadmap ----------
    h1(doc, "10. خارطة الطريق المرحلية ومعايير القبول")
    table(doc, ["المرحلة", "المدة", "المحتوى", "معيار القبول"],
          [["1 — MVP", "2–3 أسابيع",
            "بوابة موحدة + نموذجان (OpenAI، Claude) + واجهة دردشة أساسية مع بث + اختيار يدوي/تلقائي بسيط + حدود استخدام وأمان",
            "محادثة حقيقية عبر النموذجين، الإيقاف فوري، صفر تسريب أخطاء مزوّد خام، حدود الاستخدام تعمل"],
           ["2 — توسعة", "4–6 أسابيع",
            "2–3 نماذج إضافية، توجيه قائم على قواعد، اعتدال محتوى، إعادة توليد/تعديل رسالة، مرفقات كاملة",
            "التلقائي يصنف الطلبات الثلاثة (نص/كود/صورة) بشكل صحيح على مجموعة اختبار؛ الحقن المجهور يُحظر"],
           ["3 — نضج", "حسب الحاجة",
            "اختيار تلقائي ذكي (Classifier)، ذاكرة سياقية RAG (pgvector)، وكلاء متعدّدو الأدوار، لوحة تحليلات",
            "قياس كلفة/جودة لكل نموذج؛ ذاكرة سياقية عبر المحادثات"]],
          widths_mm=[26, 24, 60, 50])

    # ---------- 11. Ops ----------
    h1(doc, "11. بيئة التشغيل والنشر")
    bullet(doc, "Docker + docker-compose للتشغيل المحلي (web, api, postgres, redis, minio).")
    bullet(doc, "بيئات منفصلة: dev / staging / prod — كل بيئة بمفاتيح مستقلة.")
    bullet(doc, "CI/CD: lint + typecheck + اختبارات على كل Pull Request، ونشر عند الدمج في main.")
    bullet(doc, "قابلة للرصد: سجلات مهيكل (pino) + Request ID + مقاييس استدعاءات المزوّدين (زمن أول حرف، نسبة النجاح، الكلفة).")

    # ---------- 12. KPIs ----------
    h1(doc, "12. مؤشرات الأداء (KPIs)")
    table(doc, ["المؤشر", "الهدف"],
          [["زمن أول حرف (TTFT) — p95", "< 2 ثانية"],
           ["نسبة نجاح طلبات /v1/chat", "> 99%"],
           ["تسريب أخطاء مزوّد خام للواجهة", "0"],
           ["توافر التطبيق (Availability)", "99.5% شهرياً"],
           ["كلفة 1000 رسالة", "تُتتبع لكل نموذج وتُعرض في اللوحة (مرحلة 3)"]],
          widths_mm=[90, 70])

    # ---------- 13. Changes ----------
    h1(doc, "13. إدارة التغييرات")
    para(doc, "أي تغيير في عقد الـ API أو المخطط أو الحدود يتطلب: (1) تعديل هذا المستند وترقيم إصداره، "
              "(2) موافقة رئيس الفريق التقني، (3) سجل إصدار في الجدول بالأعلى. التغييرات الرجعية "
              "(Breaking) تتطلب خطة انتقال موثقة.")

    out = os.path.join(os.path.dirname(__file__), "..", "docs", "technical-contract.docx")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    doc.save(out)
    print(f"Saved: {os.path.abspath(out)}")


if __name__ == "__main__":
    main()
