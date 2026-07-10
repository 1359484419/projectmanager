package pm.project;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class ProjectController {

    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    public record CreateProjectRequest(String key, String name) {
    }

    public record UpdateProjectRequest(String name, Project.SprintLength defaultSprintLength,
                                       Boolean autoRotate) {
    }

    @PostMapping("/api/t/{slug}/projects")
    ProjectService.ProjectView create(@PathVariable String slug,
                                      @RequestBody CreateProjectRequest req) {
        return projectService.create(req.key(), req.name());
    }

    @GetMapping("/api/t/{slug}/projects")
    List<ProjectService.ProjectView> list(@PathVariable String slug) {
        return projectService.list();
    }

    @PatchMapping("/api/t/{slug}/projects/{key}")
    ProjectService.ProjectView update(@PathVariable String slug, @PathVariable String key,
                                      @RequestBody UpdateProjectRequest req) {
        return projectService.update(key, req.name(), req.defaultSprintLength(), req.autoRotate());
    }

    @DeleteMapping("/api/t/{slug}/projects/{key}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable String slug, @PathVariable String key) {
        projectService.delete(key);
    }
}
