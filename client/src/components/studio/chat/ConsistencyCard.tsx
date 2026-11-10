import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  ChevronRight,
  Loader2,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import {
  generateBible,
  listCharacters,
  listLocations,
  listProps,
} from '@client/src/api/bible';
import type {
  Character,
  GenerationJob,
  Location,
  Prop,
} from '@shared/api.interface';
import { isCharacterFullyDefined, isPropReady } from '@shared/api.interface';

interface ConsistencyCardProps {
  projectId: string;
  jobs: GenerationJob[];
}

/**
 * 人物 & 场景 & 道具一致性摘要（常驻在对话输入框上方）。
 *
 * 设计标准：
 *  · 常驻条固定高度、始终完整可见，不放进会滚动的消息流 header。
 *  · 三行结构：人物 → 场景 → 道具，顺序与制作圣经一致。
 *  · 人物是否「已定妆」按行业标准判定：1 张主图 + 四视图齐全，
 *    不再用「有任意一张参考图」就算完成（那会放行四视图拼图）。
 *  · 每行的入口分别指向圣经页 / 道具专页，不在对话里偷偷提交计费任务。
 */
export const ConsistencyCard = ({ projectId, jobs }: ConsistencyCardProps) => {
  const navigate = useNavigate();
  const [chars, setChars] = useState<Character[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [propItems, setPropItems] = useState<Prop[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [bibleStamp, setBibleStamp] = useState(0);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  const stamp = useMemo(() => {
    const related = jobs.filter(
      (j) => j.targetType === 'character' || j.targetType === 'location' || j.targetType === 'prop',
    );
    const last = related.reduce(
      (m, j) => (j.updatedAt && j.updatedAt > m ? j.updatedAt : m), '');
    return `${related.length}:${last}`;
  }, [jobs]);

  useEffect(() => {
    const onUpdate = () => setBibleStamp((v) => v + 1);
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listCharacters(projectId),
      listLocations(projectId),
      listProps(projectId),
    ])
      .then(([c, l, p]) => {
        if (!alive) return;
        setChars(c);
        setLocs(l);
        setPropItems(p);
      })
      .catch(() => { /* 设定还没生成时接口可能为空，不打扰用户 */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [projectId, stamp, bibleStamp]);

  const charReady = chars.filter(isCharacterFullyDefined).length;
  const locReady = locs.filter((l) => l.referenceImageUrls?.length > 0).length;
  const propReady = propItems.filter(isPropReady).length;
  const total = chars.length + locs.length + propItems.length;
  const ready = charReady + locReady + propReady;

  const runGenerate = async () => {
    if (genBusy) return;
    setGenBusy(true);
    try {
      const res = await generateBible(projectId, { mode: 'fill' });
      setChars(res.characters);
      setLocs(res.locations);
      setPropItems(res.props ?? []);
      setLoaded(true);
      window.dispatchEvent(new Event('yimu:bible-updated'));
      toast.success(
        res.source === 'llm'
          ? '制作圣经已生成，人物、场景与道具已就位'
          : '已生成人物 / 场景 / 道具草稿，请到圣经页复核',
      );
    } catch (e) {
      toast.error(`生成失败：${(e as Error).message}`);
    } finally {
      setGenBusy(false);
    }
  };

  const chip = (item: Character | Location | Prop, kind: 'char' | 'loc' | 'prop') => {
    const refs = item.referenceImageUrls ?? [];
    const hasRef = refs.length > 0;
    const charOk = kind === 'char' && isCharacterFullyDefined(item as Character);
    const propOk = kind === 'prop' && isPropReady(item as Prop);
    const status = kind === 'char' ? charOk : kind === 'prop' ? propOk : hasRef;
    const thumb = kind === 'prop'
      ? (item as Prop).referenceImageUrls?.[0]
      : kind === 'char'
        ? ((item as Character).identityKit?.portraitUrl || refs[0])
        : refs[0];
    const title = status
      ? `${item.name}：点击预览参考图`
      : kind === 'char'
        ? `${item.name}：缺主图或四视图，去圣经页补齐形象包`
        : kind === 'prop'
          ? `${item.name}：缺识别锚点或设定图，去道具页补齐`
          : `${item.name}：去圣经页绑定概念图`;
    const target = kind === 'prop' ? `/project/${projectId}/props` : `/project/${projectId}/bible`;
    return (
      <button
        key={`${kind}-${item.id}`}
        type="button"
        className={`cons-chip${status ? ' ok' : ''}`}
        title={title}
        onClick={() => status && thumb ? setPreview({ url: thumb, title: `${item.name} · 参考图` }) : navigate(target)}
      >
        <span className="cons-chip-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : kind === 'char' ? <Users size={13} /> : kind === 'loc' ? <MapPin size={13} /> : <Box size={13} />}
        </span>
        <span className="cons-chip-nm">{item.name}</span>
        {kind === 'char' && !charOk ? (
          <em className="cons-chip-num">{1 + Object.values((item as Character).identityKit?.views ?? {}).filter(Boolean).length}/5</em>
        ) : null}
        <i className="cons-chip-dot" />
      </button>
    );
  };

  if (!loaded) return null;

  return (
    <section className="cons compact">
      <div className="cons-head">
        <div className="cons-title"><Users className="ico" /> 人物 · 场景 · 道具一致性</div>
        <div className="cons-count">
          {total === 0 ? '尚未建立设定' : `${ready}/${total} 已就绪`}
        </div>
        <button type="button" className="cons-open" onClick={() => navigate(`/project/${projectId}/props`)}>
          道具页 <ChevronRight size={11} />
        </button>
        <button type="button" className="cons-open" onClick={() => navigate(`/project/${projectId}/bible`)}>
          管理设定 <ChevronRight size={11} />
        </button>
      </div>

      {total === 0 ? (
        <div className="cons-blank compact">
          <span className="cons-blank-txt">
            <Users size={13} /> 还没有人物、场景和道具设定，剧本分析后可从制作圣经一键生成
          </span>
          <button type="button" className="btn pri" onClick={() => void runGenerate()} disabled={genBusy}>
            {genBusy ? <Loader2 className="ico spin" /> : <Sparkles className="ico" />}
            {genBusy ? '生成中…' : 'AI 生成'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(`/project/${projectId}/bible`)}>打开圣经</button>
        </div>
      ) : (
        <div className="cons-lines">
          <div className="cons-line">
            <span className="cons-k">人物 <b>{chars.length}</b></span>
            <div className="cons-chips">
              {chars.length ? chars.map((c) => chip(c, 'char')) : <span className="cons-none">暂无人物</span>}
            </div>
          </div>
          <div className="cons-line">
            <span className="cons-k">场景 <b>{locs.length}</b></span>
            <div className="cons-chips">
              {locs.length ? locs.map((l) => chip(l, 'loc')) : <span className="cons-none">暂无场景</span>}
            </div>
          </div>
          <div className="cons-line">
            <span className="cons-k">道具 <b>{propItems.length}</b></span>
            <div className="cons-chips">
              {propItems.length
                ? propItems.map((p) => chip(p, 'prop'))
                : <button type="button" className="cons-none link" onClick={() => navigate(`/project/${projectId}/props`)}>
                    暂无道具 · 去道具页生成
                  </button>}
            </div>
          </div>
        </div>
      )}

      {preview ? (
        <MediaPreviewDialog url={preview.url} kind="image" title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
};
