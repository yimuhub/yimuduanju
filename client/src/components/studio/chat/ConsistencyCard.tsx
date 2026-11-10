import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Loader2, Lock, MapPin, RefreshCw, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import { generateBible, generateLocationImage, listCharacters, listLocations } from '@client/src/api/bible';
import { generateCharacterSheet } from '@client/src/api/storyboard';
import type { Character, GenerationJob, Location } from '@shared/api.interface';

interface ConsistencyCardProps {
  projectId: string;
  jobs: GenerationJob[];
}

/**
 * 人物 & 场景一致性卡：展示参考图（定妆照/概念图）的到位情况，
 * 缺失的可一键提交生成；生成完成后参考图会回写到人物/场景并归档为项目资产。
 */
export const ConsistencyCard = ({ projectId, jobs }: ConsistencyCardProps) => {
  const navigate = useNavigate();
  const [chars, setChars] = useState<Character[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [bibleStamp, setBibleStamp] = useState(0);

  // 圣经页新增人物/场景、上传参考图后即时同步（jobs 不会变化，不能只依赖 stamp）
  useEffect(() => {
    const onUpdate = () => setBibleStamp((v) => v + 1);
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, []);

  // 角色/场景图任务有进展时重拉参考图，生成完自动出现在卡里
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
    let alive = true;
    setRefreshing(true);
    Promise.all([listCharacters(projectId), listLocations(projectId)])
      .then(([c, l]) => {
        if (!alive) return;
        setChars(c);
        setLocs(l);
      })
      .catch(() => {
        /* 设定还没生成时接口可能为空/失败，不打扰用户 */
      })
      .finally(() => {
        if (!alive) return;
        setLoaded(true);
        setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, stamp, bibleStamp]);

  const missingChars = chars.filter((c) => c.referenceImageUrls.length === 0);
  const missingLocs = locs.filter((l) => l.referenceImageUrls.length === 0);
  const total = chars.length + locs.length;
  const ready = total - missingChars.length - missingLocs.length;

  const markPending = (ids: string[], value: boolean) =>
    setPending((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = value;
      return next;
    });

  const genChar = async (c: Character) => {
    if (pending[c.id]) return;
    markPending([c.id], true);
    try {
      await generateCharacterSheet(projectId, c.id, {});
      toast.success(`已提交「${c.name}」的定妆照任务`);
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`);
    } finally {
      markPending([c.id], false);
    }
  };

  const genLoc = async (l: Location) => {
    if (pending[l.id]) return;
    markPending([l.id], true);
    try {
      await generateLocationImage(projectId, l.id);
      toast.success(`已提交「${l.name}」的场景概念图任务`);
    } catch (e) {
      toast.error(`提交失败：${(e as Error).message}`);
    } finally {
      markPending([l.id], false);
    }
  };

  const generateMissing = async () => {
    const charIds = missingChars.map((c) => c.id);
    const locIds = missingLocs.map((l) => l.id);
    if (charIds.length + locIds.length === 0 || bulk) return;
    setBulk(true);
    markPending([...charIds, ...locIds], true);
    const results = await Promise.allSettled([
      ...missingChars.map((c) => generateCharacterSheet(projectId, c.id, {})),
      ...missingLocs.map((l) => generateLocationImage(projectId, l.id)),
    ]);
    markPending([...charIds, ...locIds], false);
    setBulk(false);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (ok > 0) toast.success(`已提交 ${ok} 个定妆/概念图任务，完成后自动更新`);
    if (ok < results.length) toast.error(`${results.length - ok} 个任务提交失败，请检查预算与 Provider`);
  };

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

  if (!loaded) return null;
  if (total === 0) {
    return (
      <section className="cons">
        <div className="cons-head">
          <div className="cons-title">
            <Users className="ico" />
            人物 &amp; 场景一致性
          </div>
          <div className="cons-count">尚未建立设定</div>
        </div>
        <div className="cons-blank">
          <span className="cons-blank-ico"><Sparkles className="ico" /></span>
          <b>还没有人物和场景设定</b>
          <p>
            剧本分析后，制作圣经会自动识别出场人物与场景；这里是全片人物形象一致性的起点，
            建议先生成并绑定参考图，再出首帧。
          </p>
          <div className="cons-blank-acts">
            <button type="button" className="btn pri" onClick={() => void runGenerate()} disabled={genBusy}>
              {genBusy ? <Loader2 className="ico spin" /> : <Sparkles className="ico" />}
              {genBusy ? '生成中…' : 'AI 生成制作圣经'}
            </button>
            <button type="button" className="btn" onClick={() => navigate(`/project/${projectId}/bible`)}>
              打开圣经
            </button>
          </div>
        </div>
      </section>
    );
  }

  const item = (
    key: string,
    name: string,
    refs: string[],
    locked: boolean,
    kind: 'char' | 'loc',
    onGenerate: () => void,
  ) => {
    const busyItem = !!pending[key];
    const hasRef = refs.length > 0;
    return (
      <button
        key={key}
        type="button"
        className={`cons-item${hasRef ? ' ok' : ' miss'}`}
        title={hasRef ? `${name}：点击预览参考图` : `${name}：点击生成${kind === 'char' ? '定妆照' : '概念图'}`}
        onClick={() => {
          if (hasRef) setPreview({ url: refs[0], title: `${name} · 参考图` });
          else onGenerate();
        }}
        disabled={busyItem}
      >
        <span className="cons-thumb">
          {hasRef ? (
            <img src={refs[0]} alt={name} loading="lazy" />
          ) : busyItem ? (
            <Loader2 className="spin" />
          ) : (
            <ImagePlus />
          )}
        </span>
        <span className="cons-name">{name}</span>
        <span className="cons-state">{hasRef ? '已定妆' : busyItem ? '提交中' : '待生成'}</span>
        {locked ? (
          <span className="cons-lock" title="设定已锁定">
            <Lock />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <section className="cons">
      <div className="cons-head">
        <div className="cons-title">
          <Users className="ico" />
          人物 &amp; 场景一致性
        </div>
        <div className="cons-count">
          {ready}/{total} 已定妆
          {refreshing ? <RefreshCw className="cons-refresh spin" /> : null}
        </div>
      </div>

      {chars.length > 0 ? (
        <div className="cons-row">
          <span className="cons-k">人物</span>
          <div className="cons-items">
            {chars.map((c) =>
              item(
                c.id,
                c.name,
                c.referenceImageUrls,
                c.locked,
                'char',
                () => void genChar(c),
              ),
            )}
          </div>
        </div>
      ) : null}

      {locs.length > 0 ? (
        <div className="cons-row">
          <span className="cons-k">
            <MapPin className="ico" /> 场景
          </span>
          <div className="cons-items">
            {locs.map((l) =>
              item(
                l.id,
                l.name,
                l.referenceImageUrls,
                l.locked,
                'loc',
                () => void genLoc(l),
              ),
            )}
          </div>
        </div>
      ) : null}

      <div className="cons-foot">
        <button
          type="button"
          className="btn"
          disabled={bulk || missingChars.length + missingLocs.length === 0}
          onClick={() => void generateMissing()}
        >
          {bulk ? (
            <>
              <Loader2 className="ico spin" /> 提交中…
            </>
          ) : (
            `补齐缺失（${missingChars.length + missingLocs.length}）`
          )}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => navigate(`/project/${projectId}/characters`)}
        >
          人物设定
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => navigate(`/project/${projectId}/scenes`)}
        >
          场景设定
        </button>
        <span className="cons-note">参考图会作为首帧与视频生成的一致性依据</span>
      </div>

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