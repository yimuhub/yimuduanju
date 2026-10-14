import { Controller, Get, Render } from '@nestjs/common';

@Controller()
export class ViewController {

  @Get(['/', '*'])
  @Render('index')
  async render(): Promise<Record<string, never>> {
    // 已去平台化：不再向页面注入任何平台数据（window.__platform__ 已从模板移除），
    // 只伺服我们自己的 index.html；用户身份由网关注入的本地单用户头提供。
    return {};
  }
}
