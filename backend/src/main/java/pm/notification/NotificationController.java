package pm.notification;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;

@RestController
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /** 通知下拉：{unreadCount, items:[...]}，最近 20 条（未读+已读混排，新的在前）。 */
    @GetMapping("/api/t/{slug}/notifications")
    NotificationService.ListView list(@PathVariable String slug) {
        return notificationService.list(CurrentUser.id());
    }

    /** 标单条已读（只能标自己的，幂等）。 */
    @PostMapping("/api/t/{slug}/notifications/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void markRead(@PathVariable String slug, @PathVariable Long id) {
        notificationService.markRead(id, CurrentUser.id());
    }

    /** 全部已读。 */
    @PostMapping("/api/t/{slug}/notifications/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void markAllRead(@PathVariable String slug) {
        notificationService.markAllRead(CurrentUser.id());
    }
}
