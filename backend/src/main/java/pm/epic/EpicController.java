package pm.epic;

import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pm.common.ApiException;
import pm.project.Project;
import pm.project.ProjectRepository;

import java.util.List;
import java.util.regex.Pattern;

@RestController
public class EpicController {

    static final Pattern QUARTER_PATTERN = Pattern.compile("^\\d{4}-Q[1-4]$");

    private final EpicRepository epics;
    private final ProjectRepository projects;

    public EpicController(EpicRepository epics, ProjectRepository projects) {
        this.epics = epics;
        this.projects = projects;
    }

    public record EpicView(Long id, Long projectId, String name, String description,
                           String quarter, String color, Epic.Status status) {
        static EpicView from(Epic e) {
            return new EpicView(e.getId(), e.getProjectId(), e.getName(), e.getDescription(),
                    e.getQuarter(), e.getColor(), e.getStatus());
        }
    }

    public record CreateEpicRequest(String name, String description, String quarter, String color) {
    }

    public record UpdateEpicRequest(String name, String description, String quarter, String color,
                                    Epic.Status status) {
    }

    @PostMapping("/api/t/{slug}/projects/{key}/epics")
    @Transactional
    public EpicView create(@PathVariable String slug, @PathVariable String key,
                           @RequestBody CreateEpicRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            throw ApiException.badRequest("VALIDATION", "name is required");
        }
        pm.common.FieldLimits.check(req.name(), pm.common.FieldLimits.EPIC_NAME, "Epic 名称");
        pm.common.FieldLimits.check(req.description(),
                pm.common.FieldLimits.EPIC_DESCRIPTION, "Epic 描述");
        validateQuarter(req.quarter());
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        Epic epic = new Epic(project.getId(), req.name(), req.description(), req.quarter(), req.color());
        return EpicView.from(epics.save(epic));
    }

    @GetMapping("/api/t/{slug}/projects/{key}/epics")
    public List<EpicView> list(@PathVariable String slug, @PathVariable String key) {
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        return epics.findByProjectIdOrderByIdAsc(project.getId()).stream()
                .map(EpicView::from).toList();
    }

    @PatchMapping("/api/t/{slug}/projects/{key}/epics/{id}")
    @Transactional
    public EpicView update(@PathVariable String slug, @PathVariable String key,
                           @PathVariable Long id, @RequestBody UpdateEpicRequest req) {
        Project project = projects.findByKey(key).orElseThrow(ApiException::notFound);
        Epic epic = epics.findByIdAndProjectId(id, project.getId()).orElseThrow(ApiException::notFound);
        if (req.name() != null) {
            if (req.name().isBlank()) {
                throw ApiException.badRequest("VALIDATION", "name must not be blank");
            }
            pm.common.FieldLimits.check(req.name(), pm.common.FieldLimits.EPIC_NAME, "Epic 名称");
            epic.setName(req.name());
        }
        if (req.description() != null) {
            pm.common.FieldLimits.check(req.description(),
                    pm.common.FieldLimits.EPIC_DESCRIPTION, "Epic 描述");
            epic.setDescription(req.description());
        }
        if (req.quarter() != null) {
            validateQuarter(req.quarter());
            epic.setQuarter(req.quarter());
        }
        if (req.color() != null) {
            epic.setColor(req.color());
        }
        if (req.status() != null) {
            epic.setStatus(req.status());
        }
        return EpicView.from(epics.save(epic));
    }

    static void validateQuarter(String quarter) {
        if (quarter != null && !QUARTER_PATTERN.matcher(quarter).matches()) {
            throw ApiException.badRequest("INVALID_QUARTER", "quarter must match yyyy-Q[1-4], e.g. 2026-Q3");
        }
    }
}
