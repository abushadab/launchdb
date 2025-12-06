/**
 * LaunchDB Projects Controller
 * Project management endpoints
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { AuthGuard } from '../guards/auth.guard';

@Controller('api/projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  async createProject(@Request() req, @Body() dto: CreateProjectDto) {
    return this.projectsService.createProject(req.ownerId, dto);
  }

  @Get()
  async listProjects(@Request() req) {
    return this.projectsService.listProjects(req.ownerId);
  }

  @Get(':projectId')
  async getProject(@Request() req, @Param('projectId') projectId: string) {
    return this.projectsService.getProject(projectId, req.ownerId);
  }

  @Get(':projectId/connection')
  async getConnectionInfo(@Request() req, @Param('projectId') projectId: string) {
    return this.projectsService.getConnectionInfo(projectId, req.ownerId);
  }

  @Delete(':projectId')
  async deleteProject(@Request() req, @Param('projectId') projectId: string) {
    await this.projectsService.deleteProject(projectId, req.ownerId);
    return { message: 'Project deleted' };
  }
}
