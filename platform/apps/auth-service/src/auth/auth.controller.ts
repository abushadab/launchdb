/**
 * Auth Controller
 * Path-based routing per interfaces.md §3
 * Routes: /auth/:projectId/*
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { RefreshDto, RefreshResponseDto } from './dto/refresh.dto';
import { UserResponseDto, LogoutResponseDto } from './dto/user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth/:projectId')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * POST /auth/:projectId/signup
   * Register new user
   */
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(
    @Param('projectId') projectId: string,
    @Body() dto: SignupDto,
  ): Promise<SignupResponseDto> {
    return this.authService.signup(projectId, dto);
  }

  /**
   * POST /auth/:projectId/login
   * Authenticate user
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Param('projectId') projectId: string,
    @Body() dto: LoginDto,
  ): Promise<LoginResponseDto> {
    return this.authService.login(projectId, dto);
  }

  /**
   * POST /auth/:projectId/refresh
   * Refresh access token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Param('projectId') projectId: string,
    @Body() dto: RefreshDto,
  ): Promise<RefreshResponseDto> {
    return this.authService.refresh(projectId, dto);
  }

  /**
   * POST /auth/:projectId/logout
   * Revoke refresh token
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Param('projectId') projectId: string,
    @Body() dto: RefreshDto,
  ): Promise<LogoutResponseDto> {
    await this.authService.logout(projectId, dto.refresh_token);
    return { message: 'Logged out successfully' };
  }

  /**
   * GET /auth/:projectId/user
   * Get authenticated user info
   * Requires valid JWT
   */
  @Get('user')
  @UseGuards(JwtAuthGuard)
  async getUser(
    @Param('projectId') projectId: string,
    @Request() req,
  ): Promise<UserResponseDto> {
    // req.user is set by JwtAuthGuard after validation
    return this.authService.getUser(projectId, req.user.sub);
  }
}
