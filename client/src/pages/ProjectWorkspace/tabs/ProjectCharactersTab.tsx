import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Edit3,
  Sparkles,
  Lock,
  Unlock,
  Trash2,
  X,
  Wand2,
  Grid3X3,
} from 'lucide-react';
import { bible, storyboard } from '@client/src/api';
import type { Character, UpdateCharacterRequest, CreateCharacterRequest } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';

const roleTypeColors: Record<string, string> = {
  主角: 'bg-primary/10 text-primary',
  配角: 'bg-blue-50 text-blue-600',
  反派: 'bg-red-50 text-red-600',
  路人: 'bg-gray-100 text-gray-600',
};

const getRoleColor = (roleType: string): string => {
  return roleTypeColors[roleType] || 'bg-gray-100 text-gray-600';
};

const ProjectCharactersTab = () => {
  const { id } = useParams<{ id: string }>();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiBrief, setAiBrief] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const handleAiDesign = async () => {
    if (!id || aiBrief.trim().length < 2) {
      setAiMsg('请先写一句话人物设定');
      return;
    }
    setAiBusy(true);
    try {
      const res = await storyboard.designCharacters(id, { brief: aiBrief.trim() });
      setAiMsg(`已生成 ${res.characters.length} 个人物卡（${res.characters.map((c) => c.name).join('、')}）`);
      setAiBrief('');
      loadCharacters();
    } catch (e) {
      logger.error('AI design failed:', String(e));
      setAiMsg('生成失败（需配置文本模型 Key）');
    } finally {
      setAiBusy(false);
    }
  };
  const [formData, setFormData] = useState<CreateCharacterRequest>({
    name: '',
    roleType: '主角',
    canonicalDescription: '',
    referenceImageUrls: [],
  });

  const loadCharacters = () => {
    if (!id) return;
    setLoading(true);
    bible.listCharacters(id)
      .then((data) => setCharacters(data))
      .catch((err) => {
        logger.error('Failed to load characters:', String(err));
        setError('加载角色列表失败');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCharacters();
  }, [id]);

  const filtered = characters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  // W4 一致性：标准描述一键补全（已有描述直接返回，无损）
  const handleCompleteDescription = async (charId: string) => {
    if (!id) return;
    try {
      const updated = await bible.completeCharacterDescription(id, charId);
      setCharacters((prev) => prev.map((c) => (c.id === charId ? updated : c)));
    } catch {
      setError('补全描述失败');
    }
  };

  const handleGenerateImage = async (charId: string) => {
    if (!id) return;
    setGeneratingIds((prev) => new Set(prev).add(charId));
    try {
      // P1 断链修复：之前调不存在的 /api/generation/image（必 404），改走 bible 嵌套端点
      await bible.generateCharacterImage(id, charId);
      // Image generation job started, will be processed async
    } catch (err) {
      logger.error('Generate image failed:', String(err));
      setError('生成立绘失败');
    } finally {
      setTimeout(() => {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(charId);
          return next;
        });
      }, 2000);
    }
  };

  /** V1 四视图定妆照：单图拼图（特写+正+侧+背），回写到参考图首位当权威锚点 */
  const handleGenerateSheet = async (charId: string) => {
    if (!id) return;
    setGeneratingIds((prev) => new Set(prev).add(charId));
    try {
      await storyboard.generateCharacterSheet(id, charId, {});
    } catch (err) {
      logger.error('Generate sheet failed:', String(err));
      setError('生成四视图失败（需配置图片模型 Key）');
    } finally {
      setTimeout(() => {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(charId);
          return next;
        });
        loadCharacters();
      }, 2000);
    }
  };

  const handleToggleLock = async (char: Character) => {
    if (!id) return;
    try {
      const updated = await bible.updateCharacter(id, char.id, {
        locked: !char.locked,
      } as UpdateCharacterRequest);
      setCharacters((prev) =>
        prev.map((c) => (c.id === char.id ? updated : c)),
      );
    } catch (err) {
      logger.error('Toggle lock failed:', String(err));
    }
  };

  const handleDelete = async (charId: string) => {
    if (!id) return;
    if (!await showConfirm('确定要删除这个角色吗？')) return;
    try {
      await bible.deleteCharacter(id, charId);
      setCharacters((prev) => prev.filter((c) => c.id !== charId));
    } catch (err) {
      logger.error('Delete failed:', String(err));
      setError('删除角色失败');
    }
  };

  const handleCreate = async () => {
    if (!id || !formData.name.trim()) return;
    try {
      const newChar = await bible.createCharacter(id, formData);
      setCharacters((prev) => [...prev, newChar]);
      setShowCreate(false);
      setFormData({ name: '', roleType: '主角', canonicalDescription: '', referenceImageUrls: [] });
    } catch (err) {
      logger.error('Create failed:', String(err));
      setError('创建角色失败');
    }
  };

  const handleUpdate = async () => {
    if (!id || !editingChar) return;
    try {
      const updated = await bible.updateCharacter(id, editingChar.id, {
        name: editingChar.name,
        roleType: editingChar.roleType,
        canonicalDescription: editingChar.canonicalDescription,
      } as UpdateCharacterRequest);
      setCharacters((prev) =>
        prev.map((c) => (c.id === editingChar.id ? updated : c)),
      );
      setEditingChar(null);
    } catch (err) {
      logger.error('Update failed:', String(err));
      setError('更新角色失败');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">人物角色库</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理项目中的所有角色设定，共 {characters.length} 个角色
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索角色..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56 rounded-lg border border-input bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            添加角色
          </button>
          <button
            onClick={() => setShowAi((v) => !v)}
            title="人物卡技能：一句话设定→标准人物卡，直接写入人物库"
            className="flex items-center gap-2 rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
          >
            <Wand2 className="h-4 w-4" />
            AI 设计
          </button>
        </div>
      </div>

      {/* AI 设计人物（character_design 技能） */}
      {showAi && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <textarea
            value={aiBrief}
            onChange={(e) => setAiBrief(e.target.value)}
            placeholder="一句话人物设定，如：28岁讲义气的修车工，方脸短寸，多个青梅竹马"
            rows={2}
            className="w-full resize-y rounded-lg border border-input bg-white p-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleAiDesign}
              disabled={aiBusy}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" /> {aiBusy ? '设计中…' : '生成人物卡'}
            </button>
            {aiMsg && <span className="text-xs text-muted-foreground">{aiMsg}</span>}
          </div>
        </div>
      )}

      {/* Character grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-12 text-center">
          <div className="text-sm text-muted-foreground">
            {search ? '没有匹配的角色' : '暂无角色，点击「添加角色」开始创建'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((char) => (
            <div
              key={char.id}
              className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Avatar area */}
              <div className="relative h-36 w-full">
                <MediaOrMissing
                  src={char.referenceImageUrls?.[0]}
                  alt={char.name}
                  className="h-36 w-full"
                />
                {char.locked && (
                  <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
                    <Lock className="h-3.5 w-3.5" />
                  </div>
                )}
                {generatingIds.has(char.id) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-sm">
                    生成中...
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate font-semibold text-foreground">
                    {char.name}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getRoleColor(char.roleType)}`}
                  >
                    {char.roleType}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {char.canonicalDescription || '暂无描述'}
                </p>

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => setEditingChar(char)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  <button
                    onClick={() => handleGenerateImage(char.id)}
                    disabled={generatingIds.has(char.id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    生成立绘
                  </button>
                  <button
                    onClick={() => handleGenerateSheet(char.id)}
                    disabled={generatingIds.has(char.id)}
                    title="四视图定妆照：特写+正面+侧面+背面拼图，挂参考图首位"
                    className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <Grid3X3 className="h-3.5 w-3.5" />
                    四视图
                  </button>
                  {!char.canonicalDescription && (
                    <button
                      onClick={() => handleCompleteDescription(char.id)}
                      title="按已有设定自动拼装标准描述，作为跨镜一致性锚点"
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-amber-300 bg-amber-50 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      补全描述
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleLock(char)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-white text-muted-foreground hover:text-foreground"
                    title={char.locked ? '解锁' : '锁定'}
                  >
                    {char.locked ? (
                      <Unlock className="h-3.5 w-3.5" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(char.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-white text-muted-foreground hover:text-red-500"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">添加角色</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">角色名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="请输入角色名称"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">角色类型</label>
                <select
                  value={formData.roleType}
                  onChange={(e) => setFormData({ ...formData, roleType: e.target.value })}
                  className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="主角">主角</option>
                  <option value="配角">配角</option>
                  <option value="反派">反派</option>
                  <option value="路人">路人</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">角色描述</label>
                <textarea
                  value={formData.canonicalDescription}
                  onChange={(e) => setFormData({ ...formData, canonicalDescription: e.target.value })}
                  rows={3}
                  className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="描述角色的外貌、性格、背景等"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editingChar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">编辑角色</h3>
              <button
                onClick={() => setEditingChar(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">角色名称</label>
                <input
                  type="text"
                  value={editingChar.name}
                  onChange={(e) => setEditingChar({ ...editingChar, name: e.target.value })}
                  className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">角色类型</label>
                <select
                  value={editingChar.roleType}
                  onChange={(e) => setEditingChar({ ...editingChar, roleType: e.target.value })}
                  className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="主角">主角</option>
                  <option value="配角">配角</option>
                  <option value="反派">反派</option>
                  <option value="路人">路人</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">角色描述</label>
                <textarea
                  value={editingChar.canonicalDescription || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, canonicalDescription: e.target.value })}
                  rows={4}
                  className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingChar(null)}
                className="rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                取消
              </button>
              <button
                onClick={handleUpdate}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectCharactersTab;
