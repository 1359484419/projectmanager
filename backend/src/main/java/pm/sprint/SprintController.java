package pm.sprint;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;

import java.util.List;

@RestController
public class SprintController {

    private final SprintService sprintService;
    private final CapacityService capacityService;

    public SprintController(SprintService sprintService, CapacityService capacityService) {
        this.sprintService = sprintService;
        this.capacityService = capacityService;
    }

    public record CapacityPut(int capacity) {
    }

    @PostMapping("/api/t/{slug}/projects/{key}/sprints")
    SprintService.SprintView create(@PathVariable String slug, @PathVariable String key,
                                    @RequestBody(required = false) SprintService.CreateSprintRequest req) {
        return sprintService.create(key, req);
    }

    @PostMapping("/api/t/{slug}/sprints/{id}/start")
    SprintService.SprintView start(@PathVariable String slug, @PathVariable Long id) {
        return sprintService.start(id);
    }

    @PostMapping("/api/t/{slug}/sprints/{id}/close")
    SprintService.SprintView close(@PathVariable String slug, @PathVariable Long id,
                                   @RequestBody(required = false) SprintService.CloseSprintRequest req) {
        return sprintService.close(id, req, CurrentUser.id());
    }

    @GetMapping("/api/t/{slug}/sprints/{id}/capacity")
    List<CapacityService.CapacityRow> capacity(@PathVariable String slug, @PathVariable Long id) {
        return capacityService.capacity(id);
    }

    @PutMapping("/api/t/{slug}/sprints/{id}/capacity/{userId}")
    CapacityService.CapacityRow putCapacity(@PathVariable String slug, @PathVariable Long id,
                                            @PathVariable Long userId, @RequestBody CapacityPut req) {
        return capacityService.upsertOverride(id, userId, req.capacity());
    }
}
