/**
 * CA (Comment Art) 评分与层分离模块
 * 
 * 参考 niconicomments 的 commentArt 逻辑，适配 Danmaku Cosmos 的数据格式。
 * 
 * 功能：
 * 1. 根据用户行为计算 CA 分数，识别"弹幕画"创作者
 * 2. 去重同一 CA 作品中的重复弹幕
 * 3. 将 CA 弹幕分配到独立 layer，使不同 CA 之间允许重叠，
 *    同一 CA 内部互不遮挡
 * 
 * 使用方式：
 *   在 load-danmaku 解析完弹幕后调用 assignCALayers(list)
 *   弹幕对象会获得 _layer 字段，碰撞检测时据此判断是否跨层避让
 */

// ==================== 配置常量 ====================

const CA_CONFIG = {
  /** 用户达到此分数才被视为 CA 创作者 */
  minScore: 10,

  /** 同一 CA 弹幕去重：vpos 差距超过此值视为不同时间投递，保留 */
  sameCAGap: 100,

  /** 同一 CA 弹幕去重：日期秒数差小于此值视为同一批投递，去重 */
  sameCARange: 3600,

  /** 按时间分组时，时间戳在此范围内的弹幕归为同一组 */
  sameCATimestampRange: 300,

  /** CA 相关 mail 命令的过滤正则（用于去重 key 生成） */
  caFilterRe: /@[\d.]+|184|device:.+|patissier|ca/
};

// ==================== 用户评分 ====================

/**
 * 计算每个用户的 CA 分数
 * 
 * 评分规则（参考 niconicomments）：
 * - mail 包含 ca / patissier / ender / full → +5 分
 * - 换行数 > 2 → + lineCount/2 分
 * 
 * @param {Array} danmakuList - 弹幕列表
 * @returns {Object} userId → score 的映射
 */
window.getUserCAScores = function (danmakuList) {
  const scores = {};

  for (const d of danmakuList) {
    const userId = d._userId;
    if (userId === undefined || userId === -1 || userId === null || userId === '') continue;

    if (scores[userId] === undefined) scores[userId] = 0;

    // mail 命令加分
    if (d._commands) {
      const cmdLower = d._commands.map(c => c.toLowerCase());
      if (cmdLower.includes('ca') || cmdLower.includes('patissier') ||
          cmdLower.includes('ender') || cmdLower.includes('full')) {
        scores[userId] += 5;
      }
    }
    // patissier / full / ender 标记加分（已从 commands 解析到顶层字段）
    if (d.patissier || d.full || d.ender) {
      scores[userId] += 5;
    }

    // 换行数加分
    const lineCount = (d.text && d.text.match(/\n/g) || []).length + 1;
    if (lineCount > 2) {
      scores[userId] += lineCount / 2;
    }
  }

  return scores;
}

// ==================== 去重 ====================

/**
 * 去重同一 CA 中的重复弹幕
 * 
 * 去重 key = content + 排序后的 mail 命令（过滤掉 ca 相关的噪声命令）
 * 如果两条相同 key 的弹幕：
 *   - vpos 差距 > sameCAGap → 保留（不同时间投递）
 *   - 日期差 < sameCARange → 重复，移除后者
 * 
 * @param {Array} danmakuList - 弹幕列表
 * @returns {Array} 去重后的弹幕列表
 */
window.removeDuplicateCA = function (danmakuList) {
  const index = {};
  return danmakuList.filter(d => {
    const mailKey = (d._commands || [])
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .filter(e => !CA_CONFIG.caFilterRe.test(e))
      .join('');

    const key = `${d.text}@@${mailKey}`;
    const last = index[key];

    if (last === undefined) {
      index[key] = d;
      return true;
    }

    // vpos 差距大 → 保留
    if (d.t - last.t > CA_CONFIG.sameCAGap) {
      index[key] = d;
      return true;
    }

    // 日期差小 → 重复
    const dateDiff = Math.abs((d._dateSec || 0) - (last._dateSec || 0));
    if (dateDiff < CA_CONFIG.sameCARange) {
      return false;
    }

    index[key] = d;
    return true;
  });
}

// ==================== 分组 ====================

/**
 * 按用户 ID 分组
 */
window.groupByUser = function (danmakuList) {
  const map = new Map();
  for (const d of danmakuList) {
    const userId = d._userId;
    let group = map.get(userId);
    if (!group) {
      group = { userId, comments: [] };
      map.set(userId, group);
    }
    group.comments.push(d);
  }
  return Array.from(map.values());
}

/**
 * 按投递时间分组
 * 同一用户的弹幕如果 _dateSec 在 sameCATimestampRange 范围内归为一组
 */
window.groupByTime = function (userGroups) {
  return userGroups.map(user => {
    const timeGroups = [];

    for (const comment of user.comments) {
      const dateSec = comment._dateSec || 0;
      let found = null;

      for (const tg of timeGroups) {
        if (dateSec >= tg.range.start - CA_CONFIG.sameCATimestampRange &&
            dateSec <= tg.range.end + CA_CONFIG.sameCATimestampRange) {
          found = tg;
          break;
        }
      }

      if (found) {
        found.comments.push(comment);
        found.range.start = Math.min(found.range.start, dateSec);
        found.range.end = Math.max(found.range.end, dateSec);
      } else {
        timeGroups.push({
          range: { start: dateSec, end: dateSec },
          comments: [comment]
        });
      }
    }

    return { userId: user.userId, timeGroups };
  });
}

// ==================== Layer 分配 ====================

/**
 * 为 CA 弹幕分配 layer ID
 * 
 * 规则：
 * - 同一用户、同一时间组内的弹幕共享一个 layer ID
 * - 不同时间组递增 layer ID
 * - 非 CA 弹幕 layer = -1（默认层，正常碰撞避让）
 * - 投稿者弹幕不参与 CA 层分离
 * 
 * @param {Array} timeGroupedData - 按用户+时间分组后的数据
 */
window.assignLayerIds = function (timeGroupedData) {
  let layerId = 0;
  for (const user of timeGroupedData) {
    for (const timeGroup of user.timeGroups) {
      for (const comment of timeGroup.comments) {
        comment._layer = layerId;
      }
      layerId++;
    }
  }
}

// ==================== 主入口 ====================

/**
 * 对弹幕列表执行 CA 层分离
 * 
 * 调用时机：在 load-danmaku 解析完弹幕、排序之前调用
 * 
 * @param {Array} danmakuList - 弹幕列表，每个弹幕需包含：
 *   - _userId: 用户 ID（JSON 格式有，XML 格式可能缺失）
 *   - _dateSec: 投递时间戳（秒）
 *   - _commands: mail 命令数组
 *   - _isOwner: 是否投稿者弹幕
 *   - text: 弹幕文本
 *   - patissier/full/ender: 解析后的标记
 * @returns {Array} 处理后的弹幕列表（每个弹幕新增 _layer 字段）
 */
window.assignCALayers = function (danmakuList) {
  // 1. 初始化 layer 为默认值 -1
  for (const d of danmakuList) {
    d._layer = -1;
  }

  // 2. 计算用户 CA 分数
  const userScores = getUserCAScores(danmakuList);

  // 3. 去重
  const dedupedList = removeDuplicateCA(danmakuList);

  // 4. 筛选 CA 弹幕：分数达标 + 非投稿者
  const caDanmaku = dedupedList.filter(d =>
    (userScores[d._userId] || 0) >= CA_CONFIG.minScore && !d._isOwner && !d._isFlash
  );

  if (caDanmaku.length === 0) return danmakuList;

  // 5. 按用户 → 按时间分组
  const userGroups = groupByUser(caDanmaku);
  const timeGroupedData = groupByTime(userGroups);

  // 6. 分配 layer ID（直接修改弹幕对象的 _layer 字段）
  assignLayerIds(timeGroupedData);

  return danmakuList;
}
