// @ts-nocheck — chuyển nguyên văn từ bộ test GAS (JavaScript) để chứng minh logic không đổi khi port sang TypeScript.
import { describe, it, expect } from 'vitest';
import * as g from '../src/index';

const pick = (r) => ({ format: r.format, stage: r.stage, concept: r.concept });

describe('parseAdName', () => {
  it.each([
    ['Photo MOFU Agenda', 'photo', 'MOFU', 'Photo Agenda'],
    ['Video TOFU Ad buyer', 'video', 'TOFU', 'Video Ad buyer'],
    ['Video [TOFU] Ad buyer - Bản sao', 'video', 'TOFU', 'Video Ad buyer'],
    ['Photo KV', 'photo', null, 'Photo KV'],
    ['Video ban doc', 'video', null, 'Video ban doc'],
    ['photo mofu-Agenda', 'photo', 'MOFU', 'photo Agenda'],
    ['Photo Agenda (MOFU) - Copy 2', 'photo', 'MOFU', 'Photo Agenda'],
    ['Photo Agenda - Copy - Copy', 'photo', null, 'Photo Agenda'],
  ])('%s', (name, format, stage, concept) => {
    expect(pick(g.parseAdName(name))).toEqual({ format, stage, concept });
  });

  // Tên thật từ tài khoản EVC (24/10/2026): concept = phần trước "_" đầu tiên
  it.each([
    ['Photo Agenda_WARM_Engaged+Follower+Watched_Photo', 'photo', null, 'Photo Agenda'],
    ['Photo Agenda_WARM_Engaged+Follower+Watched_Photo_USexc3', 'photo', null, 'Photo Agenda'],
    ['Photo Poster KV_WARM_Engaged+Follower+Watched_Photo', 'photo', null, 'Photo Poster KV'],
    ['Video ban doc_WARM_Engaged+Follower+Watched_MOF', 'video', 'MOFU', 'Video ban doc'],
    ['Video ban doc_Cold_US VIE 18+_Interest RE', 'video', null, 'Video ban doc'],
    ['Photo MOF 3_WARM_Engaged+Follower+Watched_Photo', 'photo', 'MOFU', 'Photo MOF 3'],
    ['Video Giải Mã ADU Từ A-Z_VIEWS 15S_BROAD 18+ exc Engaged+Followers - Copy 2', 'video', null, 'Video Giải Mã ADU Từ A-Z'],
    ['Video Wholesale_COLD_SJ+50 miles', 'video', null, 'Video Wholesale'],
  ])('tên thật: %s', (name, format, stage, concept) => {
    expect(pick(g.parseAdName(name))).toEqual({ format, stage, concept });
  });

  it('cùng creative chạy ở 2 adset khác nhau → cùng concept key', () => {
    expect(g.parseAdName('Video ban doc_WARM_Engaged+Follower+Watched_MOF').conceptKey)
      .toBe(g.parseAdName('Video ban doc_Cold_US VIE 18+_Interest RE').conceptKey);
  });

  it('không nhận nhầm stage nằm trong từ khác', () => {
    expect(g.parseAdName('Photo Tofurky promo').stage).toBeNull();
    expect(g.parseAdName('Photo Mofongo').stage).toBeNull();
  });

  it('tên không theo quy ước → UNPARSED', () => {
    expect(g.parseAdName('Carousel X')).toMatchObject({ concept: 'UNPARSED', parsed: false });
    expect(g.parseAdName('Photo')).toMatchObject({ concept: 'UNPARSED', parsed: false });
    expect(g.parseAdName('')).toMatchObject({ concept: 'UNPARSED', parsed: false });
  });

  it('cùng creative ở 2 stage → cùng concept key', () => {
    expect(g.parseAdName('Photo MOFU Agenda').conceptKey)
      .toBe(g.parseAdName('photo   agenda [TOFU] - Bản sao').conceptKey);
  });
});

describe('resolveStage', () => {
  it('ưu tiên tên ad → adset → campaign → config', () => {
    expect(g.resolveStage('Photo MOFU A', 'TOFU set', 'BOFU camp', 'TOFU')).toBe('MOFU');
    expect(g.resolveStage('Photo A', 'TOFU set', 'BOFU camp', null)).toBe('TOFU');
    expect(g.resolveStage('Photo A', 'set', 'BOFU camp', null)).toBe('BOFU');
    expect(g.resolveStage('Photo A', 'set', 'camp', 'mofu')).toBe('MOFU');
    expect(g.resolveStage('Photo A', 'set', 'camp', null)).toBeNull();
  });
});
