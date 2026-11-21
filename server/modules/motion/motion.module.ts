import { Module } from '@nestjs/common';
import { MotionController } from './motion.controller';
import { MotionService } from './motion.service';

@Module({
  controllers: [MotionController],
  providers: [MotionService],
})
export class MotionModule {}
