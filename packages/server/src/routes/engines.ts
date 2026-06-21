/**
 * 引擎管理API路由
 *
 * 提供多引擎实例的创建、销毁、启动、停止等管理功能
 */

import { FastifyInstance } from 'fastify';
import { createLogger } from '../utils/logger.js';
import { EngineManager } from '../EngineManager.js';
import { HamlibConfigSchema } from '@tx5dr/contracts';
import { requireRole, requireAbility } from '../auth/authPlugin.js';
import { UserRole } from '@tx5dr/contracts';
import { zodToJsonSchema } from 'zod-to-json-schema';

const logger = createLogger('EngineRoutes');

/**
 * 注册引擎管理路由
 */
export async function engineRoutes(fastify: FastifyInstance) {
  const engineManager = EngineManager.getInstance();
  const adminOnly = [requireRole(UserRole.ADMIN)];

  // 获取所有引擎列表
  fastify.get('/', async (_req, reply) => {
    const engines = engineManager.listEngines();
    return reply.send({
      success: true,
      engines,
      defaultEngineId: engineManager.getDefaultEngineId(),
    });
  });

  // 获取特定引擎信息
  fastify.get('/:engineId', async (req: any, reply) => {
    const { engineId } = req.params;

    const engine = engineManager.getEngine(engineId);
    if (!engine) {
      return reply.code(404).send({
        success: false,
        error: `Engine "${engineId}" not found`,
      });
    }

    const config = engineManager.getEngineConfig(engineId);
    const status = engine.getStatus();

    return reply.send({
      success: true,
      engineId,
      config,
      status,
    });
  });

  // 创建新引擎
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['engineId', 'radioConfig'],
        properties: {
          engineId: { type: 'string', minLength: 1 },
          radioConfig: zodToJsonSchema(HamlibConfigSchema),
          autoStart: { type: 'boolean', default: false },
        },
      },
    },
    onRequest: adminOnly,
  }, async (req: any, reply) => {
    const { engineId, radioConfig, autoStart } = req.body;

    // 检查引擎是否已存在
    if (engineManager.hasEngine(engineId)) {
      return reply.code(409).send({
        success: false,
        error: `Engine "${engineId}" already exists`,
      });
    }

    try {
      logger.info('Creating new engine via API', { engineId, autoStart });
      const engine = await engineManager.createEngine({
        engineId,
        radioConfig,
        autoStart: autoStart ?? false,
      });

      return reply.code(201).send({
        success: true,
        engineId,
        message: `Engine "${engineId}" created successfully`,
        status: engine.getStatus(),
      });
    } catch (error) {
      logger.error('Failed to create engine', { engineId, error });
      return reply.code(500).send({
        success: false,
        error: `Failed to create engine: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // 启动引擎
  fastify.post('/:engineId/start', {
    onRequest: requireAbility('execute', 'Engine'),
  }, async (req: any, reply) => {
    const { engineId } = req.params;

    const engine = engineManager.getEngine(engineId);
    if (!engine) {
      return reply.code(404).send({
        success: false,
        error: `Engine "${engineId}" not found`,
      });
    }

    try {
      await engineManager.startEngine(engineId);
      return reply.send({
        success: true,
        engineId,
        message: `Engine "${engineId}" started`,
        status: engine.getStatus(),
      });
    } catch (error) {
      logger.error('Failed to start engine', { engineId, error });
      return reply.code(500).send({
        success: false,
        error: `Failed to start engine: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // 停止引擎
  fastify.post('/:engineId/stop', {
    onRequest: requireAbility('execute', 'Engine'),
  }, async (req: any, reply) => {
    const { engineId } = req.params;

    const engine = engineManager.getEngine(engineId);
    if (!engine) {
      return reply.code(404).send({
        success: false,
        error: `Engine "${engineId}" not found`,
      });
    }

    try {
      await engineManager.stopEngine(engineId);
      return reply.send({
        success: true,
        engineId,
        message: `Engine "${engineId}" stopped`,
        status: engine.getStatus(),
      });
    } catch (error) {
      logger.error('Failed to stop engine', { engineId, error });
      return reply.code(500).send({
        success: false,
        error: `Failed to stop engine: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // 销毁引擎
  fastify.delete('/:engineId', {
    onRequest: adminOnly,
  }, async (req: any, reply) => {
    const { engineId } = req.params;
    const { force } = req.query;

    // 不允许删除默认引擎
    if (engineId === engineManager.getDefaultEngineId() && engineManager.getEngineCount() > 1) {
      return reply.code(400).send({
        success: false,
        error: 'Cannot delete the default engine. Set another engine as default first.',
      });
    }

    if (!engineManager.hasEngine(engineId)) {
      return reply.code(404).send({
        success: false,
        error: `Engine "${engineId}" not found`,
      });
    }

    try {
      await engineManager.destroyEngine(engineId, force === 'true');
      return reply.send({
        success: true,
        engineId,
        message: `Engine "${engineId}" destroyed`,
      });
    } catch (error) {
      logger.error('Failed to destroy engine', { engineId, error });
      return reply.code(500).send({
        success: false,
        error: `Failed to destroy engine: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // 设置默认引擎
  fastify.put('/:engineId/default', {
    onRequest: adminOnly,
  }, async (req: any, reply) => {
    const { engineId } = req.params;

    if (!engineManager.hasEngine(engineId)) {
      return reply.code(404).send({
        success: false,
        error: `Engine "${engineId}" not found`,
      });
    }

    try {
      engineManager.setDefaultEngineId(engineId);
      return reply.send({
        success: true,
        engineId,
        message: `Engine "${engineId}" set as default`,
      });
    } catch (error) {
      logger.error('Failed to set default engine', { engineId, error });
      return reply.code(500).send({
        success: false,
        error: `Failed to set default engine: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}
