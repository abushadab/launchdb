/**
 * LaunchDB Owners Controller
 * Owner authentication endpoints
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { OwnersService } from './owners.service';
import { SignupOwnerDto, SignupOwnerResponseDto } from './dto/signup-owner.dto';
import { LoginOwnerDto, LoginOwnerResponseDto } from './dto/login-owner.dto';

@Controller('api/owners')
export class OwnersController {
  constructor(private ownersService: OwnersService) {}

  @Post('signup')
  async signup(@Body() dto: SignupOwnerDto): Promise<SignupOwnerResponseDto> {
    return this.ownersService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginOwnerDto): Promise<LoginOwnerResponseDto> {
    return this.ownersService.login(dto);
  }
}
