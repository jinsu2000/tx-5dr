/**
 * EngineManager - 多引擎实例管理器
 *
 * 负责管理多个 DigitalRadioEngine 实例，实现多电台同时运行的功能。
 *
 * 设计原则：
 * - 每个引擎实例独立管理一部物理电台
 * - 支持引擎的创建、销毁、启动、停止
 * - 保持向后兼容（默认引擎 ID 为 "default"）
 */

import { type HamlibConfig } from '@tx5dr/contracts';
import { createLogger } from './utils/logger.js';

const logger = createLogger('EngineManager');

export interface EngineConfig {
  /** 引擎唯一标识符 */
  engineId: string;
  /** 电台配置 */
  radioConfig: HamlibConfig;
  /** 是否在创建后自动启动 */
  autoStart?: boolean;
}

export interface EngineInfo {
  /** 引擎 ID */
  engineId: string;
  /** 电台配置 */
  radioConfig: HamlibConfig;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 操作员 ID 列表 */
  operatorIds: string[];
  /** 创建时间 */
  createdAt: number;
}

/**
 * 引擎实例元数据（内部使用）
 */
interface EngineInstance {
  engine: import('./DigitalRadioEngine.js').DigitalRadioEngine;
  config: EngineConfig;
  createdAt: number;
}

export class EngineManager {
  private static instance: EngineManager | null = null;
  private engines: Map<string, EngineInstance> = new Map();
  private defaultEngineId: string = 'default';

  private constructor() {
    logger.info('EngineManager initialized');
  }

  /**
   * 获取 EngineManager 单例实例
   */
  static getInstance(): EngineManager {
    if (!EngineManager.instance) {
      EngineManager.instance = new EngineManager();
    }
    return EngineManager.instance;
  }

  /**
   * 创建新引擎实例
   *
   * @param config 引擎配置
   * @returns 创建的引擎实例
   * @throws 如果引擎 ID 已存在
   */
  async createEngine(config: EngineConfig): Promise<import('./DigitalRadioEngine.js').DigitalRadioEngine> {
    const { engineId, radioConfig, autoStart = false } = config;

    // 检查是否已存在
    if (this.engines.has(engineId)) {
      const error = new Error(`Engine "${engineId}" already exists`);
      logger.warn('Failed to create engine: already exists', { engineId });
      throw error;
    }

    logger.info('Creating new engine', { engineId, autoStart });

    // 动态导入避免循环依赖
    const { DigitalRadioEngine } = await import('./DigitalRadioEngine.js');

    // 创建引擎实例（使用工厂方法）
    const engine = DigitalRadioEngine.create(engineId);

    // 初始化引擎
    await engine.initialize();

    // 如果需要自动启动
    if (autoStart) {
      await engine.start();
    }

    // 保存引擎元数据
    this.engines.set(engineId, {
      engine,
      config,
      createdAt: Date.now(),
    });

    logger.info('Engine created successfully', { engineId });

    return engine;
  }

  /**
   * 获取引擎实例
   *
   * @param engineId 引擎 ID
   * @returns 引擎实例，如果不存在则返回 undefined
   */
  getEngine(engineId: string): import('./DigitalRadioEngine.js').DigitalRadioEngine | undefined {
    return this.engines.get(engineId)?.engine;
  }

  /**
   * 获取默认引擎实例（向后兼容）
   *
   * @returns 默认引擎实例
   * @throws 如果默认引擎不存在
   */
  getDefaultEngine(): import('./DigitalRadioEngine.js').DigitalRadioEngine {
    const defaultEngine = this.getEngine(this.defaultEngineId);
    if (!defaultEngine) {
      throw new Error(`Default engine "${this.defaultEngineId}" does not exist`);
    }
    return defaultEngine;
  }

  /**
   * 获取所有引擎的信息
   *
   * @returns 引擎信息列表
   */
  listEngines(): EngineInfo[] {
    const infos: EngineInfo[] = [];

    for (const [engineId, instance] of this.engines.entries()) {
      try {
        infos.push({
          engineId,
          radioConfig: instance.config.radioConfig,
          isRunning: instance.engine.getStatus().isRunning ?? false,
          operatorIds: instance.engine.operatorManager.getAllOperators().map(op => op.config.id),
          createdAt: instance.createdAt,
        });
      } catch (error) {
        // 引擎可能处于错误状态，尝试提供基本信息
        logger.warn('Failed to get engine info', { engineId, error });
        infos.push({
          engineId,
          radioConfig: instance.config.radioConfig,
          isRunning: false,
          operatorIds: [],
          createdAt: instance.createdAt,
        });
      }
    }

    return infos;
  }

  /**
   * 获取引擎配置
   *
   * @param engineId 引擎 ID
   * @returns 引擎配置，如果不存在则返回 undefined
   */
  getEngineConfig(engineId: string): EngineConfig | undefined {
    return this.engines.get(engineId)?.config;
  }

  /**
   * 销毁引擎实例
   *
   * @param engineId 引擎 ID
   * @param force 是否强制销毁（即使引擎正在运行）
   */
  async destroyEngine(engineId: string, force: boolean = false): Promise<void> {
    const instance = this.engines.get(engineId);
    if (!instance) {
      logger.warn('Attempted to destroy non-existent engine', { engineId });
      return;
    }

    logger.info('Destroying engine', { engineId, force });

    // 尝试正常停止引擎
    try {
      const status = instance.engine.getStatus();
      if (status.isRunning) {
        if (force) {
          await instance.engine.stop();
        } else {
          logger.warn('Engine is running, skipping destroy without force', { engineId });
          throw new Error(`Engine "${engineId}" is running. Stop it first or use force=true.`);
        }
      }
    } catch (error) {
      if (!force) {
        throw error;
      }
      logger.warn('Error stopping engine during destroy, continuing with force destroy', { engineId, error });
    }

    // 销毁引擎
    try {
      await instance.engine.destroy();
    } catch (error) {
      logger.error('Error during engine destroy', { engineId, error });
    }

    // 从 Map 中移除
    this.engines.delete(engineId);

    logger.info('Engine destroyed', { engineId });
  }

  /**
   * 启动引擎
   *
   * @param engineId 引擎 ID
   */
  async startEngine(engineId: string): Promise<void> {
    const engine = this.getEngine(engineId);
    if (!engine) {
      throw new Error(`Engine "${engineId}" does not exist`);
    }

    logger.info('Starting engine', { engineId });
    await engine.start();
    logger.info('Engine started', { engineId });
  }

  /**
   * 停止引擎
   *
   * @param engineId 引擎 ID
   */
  async stopEngine(engineId: string): Promise<void> {
    const engine = this.getEngine(engineId);
    if (!engine) {
      throw new Error(`Engine "${engineId}" does not exist`);
    }

    logger.info('Stopping engine', { engineId });
    await engine.stop();
    logger.info('Engine stopped', { engineId });
  }

  /**
   * 设置默认引擎 ID
   *
   * @param engineId 引擎 ID
   */
  setDefaultEngineId(engineId: string): void {
    if (!this.engines.has(engineId)) {
      throw new Error(`Engine "${engineId}" does not exist`);
    }
    this.defaultEngineId = engineId;
    logger.info('Default engine changed', { engineId });
  }

  /**
   * 获取默认引擎 ID
   */
  getDefaultEngineId(): string {
    return this.defaultEngineId;
  }

  /**
   * 检查引擎是否存在
   */
  hasEngine(engineId: string): boolean {
    return this.engines.has(engineId);
  }

  /**
   * 获取引擎数量
   */
  getEngineCount(): number {
    return this.engines.size;
  }

  /**
   * 销毁所有引擎实例
   */
  async destroyAll(): Promise<void> {
    logger.info('Destroying all engines', { count: this.engines.size });

    const engineIds = Array.from(this.engines.keys());
    for (const engineId of engineIds) {
      try {
        await this.destroyEngine(engineId, true);
      } catch (error) {
        logger.error('Failed to destroy engine during destroyAll', { engineId, error });
      }
    }

    logger.info('All engines destroyed');
  }
}
