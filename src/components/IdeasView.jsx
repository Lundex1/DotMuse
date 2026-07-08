import React, { useState, useEffect, useRef } from 'react';
import { t } from '../lib/i18n.js';

// 按日期分组：{ '2026-07-07': [idea, ...], ... }，键倒序
function groupByDate(ideas) {
  const g = {};
  for (const it of ideas) {
    const d = (it.created_at || '').slice(0, 10);
    (g[d] = g[d] || []).push(it);
  }
  return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]));
}

function dateLabel(d) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const yest = new Date(today.getTime() - 86400000);
  const yestStr = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
  if (d === todayStr) return t('今天');
  if (d === yestStr) return t('昨天');
  const [, m, day] = d.split('-');
  return t('{m}月{d}日', { m: Number(m), d: Number(day) });
}

const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function fullText(title, plain) {
  return `${title || t('未命名灵感')}\n\n${plain}`;
}

async function copyPlain(text, showToast) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  showToast?.(t('已复制全文，去右侧 AI 助手粘贴即可'));
}

// 编辑器：contentEditable + execCommand，轻量排版够用
function IdeaEditor({ idea, onClose, onSaved, onDelete, showToast }) {
  const [title, setTitle] = useState(idea.title || '');
  const bodyRef = useRef(null);
  const dirty = useRef(false);

  // webview 会扣住焦点：打开编辑器时先收回来，否则正文点不进去、光标不闪
  useEffect(() => {
    document.activeElement?.blur?.();
    const t = setTimeout(() => bodyRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const cmd = (name, val) => {
    bodyRef.current?.focus();
    document.execCommand(name, false, val);
    dirty.current = true;
  };

  const save = async (close) => {
    const content = bodyRef.current?.innerHTML ?? idea.content;
    await window.refhub.updateIdea(idea.id, { title, content });
    dirty.current = false;
    onSaved();
    if (close) onClose();
  };

  const COLORS = ['#29443d', '#2fae9e', '#4a7de0', '#e8a13c', '#e5766e', '#9b59b6'];

  return (
    <div className="detail-overlay" onClick={() => save(true)}>
      <div className="idea-editor" onClick={(e) => e.stopPropagation()}>
        <div className="idea-head">
          <input
            type="text"
            className="idea-title"
            placeholder={t('灵感标题…')}
            value={title}
            onChange={(e) => { setTitle(e.target.value); dirty.current = true; }}
          />
          <span className="count">{idea.created_at?.slice(0, 16)}</span>
          <button
            title={t('复制标题+正文，去右侧 AI 助手粘贴')}
            onClick={async () => {
              await save(false);
              const plain = stripHtml(bodyRef.current?.innerHTML || '');
              copyPlain(fullText(title, plain), showToast);
            }}
          >
            {t('复制全文')}
          </button>
          <button className="danger ghost" onClick={() => onDelete(idea)}>{t('删除')}</button>
          <button className="primary" onClick={() => save(true)}>{t('完成')}</button>
        </div>
        <div className="idea-toolbar">
          <button className="fmt-btn" style={{ fontWeight: 800 }} onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }}>B</button>
          <button className="fmt-btn" style={{ fontStyle: 'italic' }} onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }}>I</button>
          <button className="fmt-btn" style={{ textDecoration: 'underline' }} onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }}>U</button>
          <span className="sep" />
          <button className="fmt-btn" title={t('左对齐')} onMouseDown={(e) => { e.preventDefault(); cmd('justifyLeft'); }}>⇤</button>
          <button className="fmt-btn" title={t('居中')} onMouseDown={(e) => { e.preventDefault(); cmd('justifyCenter'); }}>⇔</button>
          <button className="fmt-btn" title={t('右对齐')} onMouseDown={(e) => { e.preventDefault(); cmd('justifyRight'); }}>⇥</button>
          <span className="sep" />
          <button className="fmt-btn" title={t('无序列表')} onMouseDown={(e) => { e.preventDefault(); cmd('insertUnorderedList'); }}>≔</button>
          <button className="fmt-btn" title={t('有序列表')} onMouseDown={(e) => { e.preventDefault(); cmd('insertOrderedList'); }}>№</button>
          <span className="sep" />
          <select
            defaultValue="3"
            title={t('字号')}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => cmd('fontSize', e.target.value)}
          >
            <option value="2">{t('小')}</option>
            <option value="3">{t('正文')}</option>
            <option value="5">{t('大')}</option>
            <option value="6">{t('特大')}</option>
          </select>
          {COLORS.map((c) => (
            <span key={c} className="color-dot" style={{ background: c }}
              onMouseDown={(e) => { e.preventDefault(); cmd('foreColor', c); }} />
          ))}
        </div>
        <div
          ref={bodyRef}
          className="idea-body"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={t('写下灵感——想法、参考方向、看到的好东西…')}
          dangerouslySetInnerHTML={{ __html: idea.content || '' }}
          onInput={() => { dirty.current = true; }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
          }}
        />
      </div>
    </div>
  );
}

export default function IdeasView({ showToast, openRequest }) {
  const [ideas, setIdeas] = useState([]);
  const [editing, setEditing] = useState(null); // 完整 idea
  const openTsRef = useRef(0);

  const reload = () => window.refhub.listIdeas().then(setIdeas);
  useEffect(() => { reload(); }, []);

  // 全局搜索直达
  useEffect(() => {
    if (!openRequest || openRequest.ts === openTsRef.current) return;
    openTsRef.current = openRequest.ts;
    window.refhub.getIdea(openRequest.id).then((it) => it && setEditing(it));
  }, [openRequest]);

  const create = async () => {
    const idea = await window.refhub.createIdea();
    setEditing(idea);
  };

  const open = async (it) => setEditing(await window.refhub.getIdea(it.id));

  const del = async (it, e) => {
    e?.stopPropagation();
    if (!confirm(t('删除灵感「{title}」？', { title: it.title || t('未命名') }))) return;
    await window.refhub.deleteIdea(it.id);
    setEditing(null);
    reload();
    showToast?.(t('已删除'));
  };

  const groups = groupByDate(ideas);

  return (
    <>
      <div className="toolbar">
        <span className="title">{t('灵感笔记')}</span>
        <span className="count">{t('{n} 条', { n: ideas.length })}</span>
        <span className="grow" />
        <button className="primary" onClick={create}>{t('✎ 记一条灵感')}</button>
      </div>
      <div className="waterfall-wrap">
        {!ideas.length && (
          <div className="empty">
            <div className="glyph">✎</div>
            {t('脑子里闪过什么就记什么，')}
            <br />{t('自动按日期整理，不用操心归档。')}
          </div>
        )}
        {groups.map(([date, list]) => (
          <div key={date} className="idea-group">
            <div className="idea-date">
              <span className="dot" />{dateLabel(date)}
              <span className="sub">{date}</span>
            </div>
            <div className="notes-waterfall">
              {list.map((it, i) => (
                <div
                  key={it.id}
                  className="note-card"
                  style={{ animationDelay: `${Math.min(i * 40, 300)}ms` }}
                  onClick={() => open(it)}
                >
                  <div className="note-title">{it.title || t('未命名灵感')}</div>
                  <div className="note-preview">{stripHtml(it.preview) || t('（空白）')}</div>
                  <div className="note-foot">
                    <span>{it.updated_at?.slice(11, 16)}</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="ghost"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const full = await window.refhub.getIdea(it.id);
                          const plain = stripHtml(full?.content || '');
                          if (!plain) { showToast?.(t('这条笔记还是空的')); return; }
                          copyPlain(fullText(full.title, plain), showToast);
                        }}
                      >
                        {t('复制')}
                      </button>
                      <button className="ghost danger" onClick={(e) => del(it, e)}>{t('删除')}</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <IdeaEditor
          idea={editing}
          onClose={() => { setEditing(null); reload(); }}
          onSaved={reload}
          onDelete={(it) => del(it)}
          showToast={showToast}
        />
      )}
    </>
  );
}
