import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Loader2,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import { generateBible, listCharacters, listLocations } from '@client/src/api/bible';
import type { Character, GenerationJob, Location } from '@shared/api.interface';

interface ConsistencyCardProps {
  projectId: string;
  jobs: GenerationJob[];
}

/**
 * 人物 & 场景一致性摘要（常驻在对话输入框上方）。
 *
 * 设计标准：
 *  · 不再放进消息流的 header —— 那里会随消息滚动、默认只露出半截；
 *    常驻条固定高度、始终完整可见。
 *  · 一行人物 + 一行场景，缩略图 / 名称 / 定妆状态都在，点击未定妆项
 *    跳到圣经页绑定形象图（不在对话里偷偷提交计费任务）。
 *  · 人物/场景为 0 时不隐藏，给出「AI 生成制作圣经」直达入口。
 */
export const ConsistencyCard = ({ projectId, jobs }: ConsistencyCardProps) => {
  const navigate = useNavigate();
  const [chars, setChars] = useState<Character[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [bibleStamp, setBibleStamp] = useState(0);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  // 角色/场景图任务有进展，或圣经页新增/编辑设定后重拉（jobs 不变时靠事件）
  const stamp = useMemo(() => {
    const related = jobs.filter(
      (j) => j.targetType === 'character' || j.targetType === 'location',
    );
    const last = related.reduce(
      (m, j) => (j.updatedAt && j.updatedAt > m ? j.updatedAt : m),
      '',
    );
    return `${related.length}:${last}`;
  }, [jobs]);

  useEffect(() => {
    const onUpdate = () => setBibleStamp((v) => v + 1);
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listCharacters(projectId), listLocations(projectId)])
      .then(([c, l]) => {
        if (!alive) return;
        setChars(c);
        setLocs(l);
      })
      .catch(() => {
        /* 设定还没生成时接口可能为空，不打扰用户 */
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId, stamp, bibleStamp]);

  const total = chars.length + locs.length;
  const ready =
    chars.filter((c) => c.referenceImageUrls.length > 0).length +
    locs.filter((l) => l.referenceImageUrls.length > 0).length;

  /** 空态直达生成：剧本分析后人物/场景一直为空，就是因为没有人把它们写进设定表 */
  const runGenerate = async () => {
    if (genBusy) return;
    setGenBusy(true);
    try {
      const res = await generateBible(projectId, { mode: 'fill' });
      setChars(res.characters);
      setLocs(res.locations);
      setLoaded(true);
      window.dispatchEvent(new Event('yimu:bible-updated'));
      toast.success(
        res.source === 'llm'
          ? '制作圣经已生成，人物与场景已就位'
          : '已生成人物与场景草稿，请到圣经页复核',
      );
    } catch (e) {
      toast.error(`生成失败：${(e as Error).message}`);
    } finally {
      setGenBusy(false);
    }
  };

  const chip = (item: Character | Location, kind: 'char' | 'loc') => {
    const refs = item.referenceImageUrls ?? [];
    const hasRef = refs.length > 0;
    return (
      <button
        key={item.id}
        type="button"
        className={`cons-chip${hasRef ? ' ok' : ''}`}
        title={hasRef ? `${item.name}：点击预览参考图` : `${item.name}：去圣经页绑定形象图`}
        onClick={() =>
          hasRef
            ? setPreview({ url: refs[0], title: `${item.name} · 参考图` })
            : navigate(`/project/${projectId}/bible`)
        }
      >
        <span className="cons-chip-thumb">
          {hasRef ? (
            <img src={refs[0]} alt="" loading="lazy" />
          ) : kind === 'char' ? (
            <Users size={13} />
          ) : (
            <MapPin size={13} />
          )}
        </span>
        <span className="cons-chip-nm">{item.name}</span>
        <i className="cons-chip-dot" />
      </button>
    );
  };

  if (!loaded) return null;

  return (
    <section className="cons compact">
      <div className="cons-head">
        <div className="cons-title">
          <Users className="ico" />
          人物 &amp; 场景一致性
        </div>
        <div className="cons-count">
          {total === 0 ? '尚未建立设定' : `${ready}/${total} 已定妆`}
        </div>
        <button
          type="button"
          className="cons-open"
          onClick={() => navigate(`/project/${projectId}/bible`)}
        >
          管理设定 <ChevronRight size={11} />
        </button>
      </div>

      {total === 0 ? (
        <div className="cons-blank compact">
          <span className="cons-blank-txt">
            <Users size={13} /> 还没有人物和场景设定，剧本分析后可从制作圣经一键生成
          </span>
          <button type="button" className="btn pri" onClick={() => void runGenerate()} disabled={genBusy}>
            {genBusy ? <Loader2 className="ico spin" /> : <Sparkles className="ico" />}
            {genBusy ? '生成中…' : 'AI 生成'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(`/project/${projectId}/bible`)}>
            打开圣经
          </button>
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
        </div>
      )}

      {preview ? (
        <MediaPreviewDialog
          url={preview.url}
          kind="image"
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
};
