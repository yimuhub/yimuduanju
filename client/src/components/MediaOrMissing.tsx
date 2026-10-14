import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Image } from '@client/src/components/ui/image';

interface MediaOrMissingProps {
  src?: string | null;
  alt?: string;
  className?: string;
  /** 加载失败/无地址时展示的文案（诚实占位，默认「未获取」） */
  missingLabel?: string;
  /** 非图片/视频时的自定义节点（图标等） */
  children?: React.ReactNode;
}

/** 有图真渲染；取不到/加载失败一律显示「未获取」，禁止首字母/渐变假占位。 */
export function MediaOrMissing({
  src,
  alt = '',
  className,
  missingLabel = '未获取',
  children,
}: MediaOrMissingProps) {
  const [failed, setFailed] = useState(false);
  const showMissing = !src || failed;

  if (showMissing) {
    return (
      <div
        data-missing="1"
        className={cn(
          'flex h-full w-full items-center justify-center bg-muted',
          className,
        )}
      >
        <span className="text-xs font-medium text-muted-foreground">{missingLabel}</span>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('h-full w-full overflow-hidden', className)}>
      <Image
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export default MediaOrMissing;
