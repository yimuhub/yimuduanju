import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MotionService } from './motion.service';

@Controller('api/motion')
export class MotionController {
  constructor(private readonly motion: MotionService) {}

  @Get('projects')
  list() {
    return this.motion.list();
  }

  @Post('projects')
  create(@Body() body: { title?: string; document?: unknown }) {
    return this.motion.create(body);
  }

  @Get('projects/:id')
  get(@Param('id') id: string) {
    return this.motion.get(id);
  }

  @Patch('projects/:id')
  update(@Param('id') id: string, @Body() body: { title?: string; document?: unknown }) {
    return this.motion.update(id, body);
  }

  @Delete('projects/:id')
  remove(@Param('id') id: string) {
    return this.motion.remove(id);
  }

  @Post('projects/:id/render')
  render(@Param('id') id: string) {
    return this.motion.startRender(id);
  }

  @Get('render/:jobId')
  job(@Param('jobId') jobId: string) {
    return this.motion.getJob(jobId);
  }
}
