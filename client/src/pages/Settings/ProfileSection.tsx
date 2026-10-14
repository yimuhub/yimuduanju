const ProfileSection = () => {
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-foreground">个人设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理你的账户信息
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#FF7A3A] text-xl font-semibold text-white">
            YM
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">一木用户</h2>
            <p className="text-sm text-muted-foreground">
              创意制作人 · VIP会员
            </p>
          </div>
          <button className="ml-auto rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary">
            编辑资料
          </button>
        </div>

        <div className="mt-6 space-y-3 border-t pt-5">
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-foreground">
                修改密码
              </div>
              <div className="text-xs text-muted-foreground">
                定期修改密码以保障账户安全
              </div>
            </div>
            <button className="text-sm text-primary hover:underline">
              修改
            </button>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-foreground">
                邮箱通知
              </div>
              <div className="text-xs text-muted-foreground">
                接收任务完成和预算提醒邮件
              </div>
            </div>
            <button className="relative h-6 w-11 rounded-full bg-primary">
              <span className="absolute top-0.5 h-5 w-5 translate-x-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProfileSection;
