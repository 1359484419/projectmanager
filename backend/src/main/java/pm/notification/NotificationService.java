package pm.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * 消息中心：任务指派通知的写入与查询。
 * 触发规则（产品决策）：创建任务带 assignee 或 assignee 变更都通知新 assignee；
 * 自己指派给自己不通知。
 */
@Service
public class NotificationService {

    /** 下拉列表条数上限：未读优先场景下 20 条足够（未读更多时以 unreadCount 徽标体现）。 */
    static final int LIST_LIMIT = 20;

    private final NotificationRepository notifications;

    public NotificationService(NotificationRepository notifications) {
        this.notifications = notifications;
    }

    public record ItemView(Long id, Long taskId, String type, String taskTitle,
                           String displayKey, String projectKey,
                           Instant readAt, Instant createdAt) {
        static ItemView from(NotificationRow r) {
            return new ItemView(r.getId(), r.getTaskId(), r.getType(), r.getTaskTitle(),
                    r.getProjectKey() + "-" + r.getTaskSeq(), r.getProjectKey(),
                    r.getReadAt(), r.getCreatedAt());
        }
    }

    public record ListView(long unreadCount, List<ItemView> items) {
    }

    /** 指派通知：recipient 为空或是操作者本人则不产生。 */
    public void recordAssigned(Long taskId, Long recipientId, Long actor) {
        if (recipientId == null || recipientId.equals(actor)) {
            return;
        }
        notifications.save(new Notification(recipientId, taskId));
    }

    @Transactional(readOnly = true)
    public ListView list(Long userId) {
        return new ListView(notifications.countUnread(userId),
                notifications.findRecentByUser(userId, LIST_LIMIT).stream()
                        .map(ItemView::from).toList());
    }

    @Transactional
    public void markRead(Long id, Long userId) {
        notifications.markRead(id, userId);
    }

    @Transactional
    public void markAllRead(Long userId) {
        notifications.markAllRead(userId);
    }

    /** 任务删除级联：清掉该任务的所有通知（谁的都清，任务都没了）。 */
    public void deleteByTask(Long taskId) {
        notifications.deleteByTaskId(taskId);
    }

    /** 项目删除级联：按任务 id 批量清通知。 */
    public void deleteByTasks(java.util.Collection<Long> taskIds) {
        notifications.deleteByTaskIdIn(taskIds);
    }
}
