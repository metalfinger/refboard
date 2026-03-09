import React, { useState, useEffect, useRef } from 'react';
import { shareCollection, getCollectionShareInfo, getCollectionDetail, addCollectionMember, removeCollectionMember, searchUsers } from '../api';
import { useAuth } from '../auth';

interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
}

interface UserResult {
  id: string;
  email: string;
  username: string;
  display_name: string;
}

interface ShareDialogProps {
  collectionId: string;
  onClose: () => void;
}

export default function ShareDialog({ collectionId, onClose }: ShareDialogProps) {
  const { user } = useAuth();
  const [pub, setPub] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('editor');
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<UserResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOwner = user?.id === ownerId;
  const shareUrl = shareToken ? `${window.location.origin}/c/${shareToken}` : '';

  async function loadData() {
    try {
      const [shareRes, detailRes] = await Promise.all([
        getCollectionShareInfo(collectionId),
        getCollectionDetail(collectionId),
      ]);
      setPub(shareRes.data.is_public);
      setShareToken(shareRes.data.share_token);
      setMembers(detailRes.data.members || []);
      setOwnerId(detailRes.data.collection?.created_by || '');
    } catch (err) {
      console.error('Failed to load share data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [collectionId]);

  function handleQueryChange(val: string) {
    setQuery(val);
    setSelectedUser(null);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchTimer.current = setTimeout(async () => {
      try {
        const res = await searchUsers(val);
        const memberIds = new Set(members.map(m => m.user_id));
        const filtered = (res.data.users || []).filter(
          (u: UserResult) => u.id !== user?.id && !memberIds.has(u.id)
        );
        setSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 200);
  }

  function selectUser(u: UserResult) {
    setSelectedUser(u);
    setQuery(u.display_name || u.email);
    setShowSuggestions(false);
  }

  async function handleTogglePublic() {
    try {
      const res = await shareCollection(collectionId, !pub);
      setPub(res.data.is_public);
      setShareToken(res.data.share_token);
    } catch (err) {
      console.error('Failed to update share settings:', err);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddMember() {
    const target = selectedUser;
    if (!target) {
      // Try searching by exact email
      if (!query.trim()) return;
      setAdding(true);
      try {
        await addCollectionMember(collectionId, query.trim(), role);
        setQuery('');
        setSelectedUser(null);
        await loadData();
      } catch (err: any) {
        alert(err.response?.data?.error || 'User not found');
      } finally {
        setAdding(false);
      }
      return;
    }

    setAdding(true);
    try {
      await addCollectionMember(collectionId, target.email, role);
      setQuery('');
      setSelectedUser(null);
      setSuggestions([]);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add member');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member?')) return;
    try {
      await removeCollectionMember(collectionId, userId);
      await loadData();
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  }

  if (loading) {
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.modal} onClick={(e) => e.stopPropagation()}>
          <div style={{ color: '#666', textAlign: 'center', padding: '20px', fontSize: '13px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.title}>Share Collection</h2>
          <button style={s.closeBtn} onClick={onClose}>{'\u00D7'}</button>
        </div>

        {/* Visibility */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Visibility</div>
          <div style={s.toggleRow}>
            <span style={{ fontSize: '13px', color: '#ccc' }}>
              {pub ? 'Public — anyone with link can view' : 'Private — members only'}
            </span>
            {isOwner && (
              <button
                style={{ ...s.toggleSwitch, background: pub ? '#4a9eff' : '#555' }}
                onClick={handleTogglePublic}
              >
                <div style={{ ...s.toggleKnob, left: pub ? '23px' : '3px' }} />
              </button>
            )}
          </div>

          {pub && shareUrl && (
            <div style={s.linkRow}>
              <input style={s.linkInput} value={shareUrl} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button style={{ ...s.copyBtn, background: copied ? '#4ade80' : '#4a9eff' }} onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>

        {/* Members */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Members ({members.length})</div>

          {isOwner && (
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <div style={s.addRow}>
                <input
                  ref={inputRef}
                  style={s.input}
                  type="text"
                  placeholder="Search by name or email..."
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddMember(); }}
                />
                <select value={role} onChange={(e) => setRole(e.target.value)} style={s.roleSelect}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button style={{ ...s.addBtn, opacity: adding ? 0.7 : 1 }} onClick={handleAddMember} disabled={adding}>
                  Add
                </button>
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && (
                <div style={s.dropdown}>
                  {suggestions.map((u) => (
                    <button key={u.id} style={s.dropdownItem} onClick={() => selectUser(u)}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '13px', color: '#e0e0e0' }}>{u.display_name}</span>
                        <span style={{ fontSize: '11px', color: '#888' }}>{u.email}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Member list */}
          {members.map((m) => (
            <div key={m.user_id} style={s.memberRow}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div style={s.avatar}>
                  {(m.display_name || m.email)[0].toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.display_name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.email}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={getRoleBadgeStyle(m.role)}>{m.role}</span>
                {isOwner && m.role !== 'owner' && (
                  <button style={s.removeBtn} onClick={() => handleRemove(m.user_id)}>Remove</button>
                )}
              </div>
            </div>
          ))}

          {members.length === 0 && (
            <div style={{ fontSize: '13px', color: '#555', padding: '10px 0' }}>No members yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function getRoleBadgeStyle(role: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    owner: { bg: 'rgba(255, 215, 0, 0.12)', color: '#ffd700' },
    editor: { bg: 'rgba(74, 158, 255, 0.12)', color: '#4a9eff' },
    viewer: { bg: 'rgba(136, 136, 136, 0.12)', color: '#888' },
  };
  const c = colors[role] || colors.viewer;
  return {
    fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px',
    background: c.bg, color: c.color,
  };
}

const s = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#252525', borderRadius: '10px', padding: '24px', width: '100%', maxWidth: '440px', border: '1px solid #333', maxHeight: '80vh', overflow: 'auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' },
  title: { margin: 0, fontSize: '16px', fontWeight: 600, color: '#e0e0e0' },
  closeBtn: { background: 'transparent', border: 'none', color: '#666', fontSize: '18px', cursor: 'pointer', padding: '4px', lineHeight: 1 },
  section: { marginBottom: '18px' },
  sectionTitle: { fontSize: '11px', fontWeight: 600, color: '#666', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#1e1e1e', borderRadius: '6px', border: '1px solid #333' },
  toggleSwitch: { position: 'relative' as const, width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', transition: 'background 0.2s', border: 'none', padding: 0 },
  toggleKnob: { position: 'absolute' as const, top: '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' },
  linkRow: { display: 'flex', gap: '6px', marginTop: '8px' },
  linkInput: { flex: 1, padding: '7px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: '5px', color: '#ccc', fontSize: '12px', outline: 'none', fontFamily: 'monospace' },
  copyBtn: { padding: '7px 14px', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  addRow: { display: 'flex', gap: '6px' },
  input: { flex: 1, padding: '7px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: '5px', color: '#e0e0e0', fontSize: '12px', outline: 'none' },
  roleSelect: { padding: '7px 8px', background: '#1e1e1e', border: '1px solid #333', borderRadius: '5px', color: '#e0e0e0', fontSize: '12px', cursor: 'pointer', outline: 'none' },
  addBtn: { padding: '7px 14px', background: '#4a9eff', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
  dropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, background: '#2d2d2d', border: '1px solid #444', borderRadius: '6px', marginTop: '4px', overflow: 'hidden', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' },
  dropdownItem: { display: 'flex', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid #333', cursor: 'pointer', textAlign: 'left' as const },
  memberRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#1e1e1e', borderRadius: '6px', marginBottom: '4px', border: '1px solid #2a2a2a' },
  avatar: { width: '28px', height: '28px', borderRadius: '50%', background: '#4a9eff20', color: '#4a9eff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 },
  removeBtn: { background: 'transparent', border: '1px solid #5a2d2d', borderRadius: '4px', color: '#ff6b6b', fontSize: '10px', padding: '3px 8px', cursor: 'pointer' },
};
