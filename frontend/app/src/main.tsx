import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { RequireRoleSession } from "@/components/auth/RequireRoleSession";
import { homeForRole } from "@/components/layout/nav";
import { AppShell } from "@/components/layout/AppShell";
import { Providers } from "@/providers/Providers";
import { useCurrentUser } from "@/api/hooks";
import { AdminPlaceholder } from "@/routes/admin/AdminPlaceholder";
import { AdminUsersPage } from "@/routes/admin/AdminUsersPage";
import { AdminInvitesPage } from "@/routes/admin/AdminInvitesPage";
import { AdminSystemPage } from "@/routes/admin/AdminSystemPage";
import { StudentDashboardPage } from "@/routes/student/StudentDashboardPage";
import { StudentCoursesPage } from "@/routes/student/StudentCoursesPage";
import { StudentCourseDetailPage } from "@/routes/student/StudentCourseDetailPage";
import { StudentAssignmentPage } from "@/routes/student/StudentAssignmentPage";
import { StudentResultPage } from "@/routes/student/StudentResultPage";
import { TeacherDashboardPage } from "@/routes/teacher/TeacherDashboardPage";
import { TeacherCoursesPage } from "@/routes/teacher/TeacherCoursesPage";
import { TeacherCourseDetailPage } from "@/routes/teacher/TeacherCourseDetailPage";
import { TeacherAssignmentDetailPage } from "@/routes/teacher/TeacherAssignmentDetailPage";
import { TeacherGradingPage } from "@/routes/teacher/TeacherGradingPage";
import { AssignmentEditorPage } from "@/routes/teacher/AssignmentEditorPage";
import { TeacherSubmissionsPage } from "@/routes/teacher/TeacherSubmissionsPage";
import { TeacherResultsPage } from "@/routes/teacher/TeacherResultsPage";
import "@/styles/globals.css";

const ExpertsPage = React.lazy(() => import("@/routes/ExpertsPage").then((module) => ({ default: module.ExpertsPage })));
const KnowledgeBasePage = React.lazy(() =>
  import("@/routes/KnowledgeBasePage").then((module) => ({ default: module.KnowledgeBasePage })),
);
const LoginPage = React.lazy(() => import("@/routes/LoginPage").then((module) => ({ default: module.LoginPage })));
const NotFoundPage = React.lazy(() =>
  import("@/routes/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);
const RegisterPage = React.lazy(() => import("@/routes/RegisterPage").then((module) => ({ default: module.RegisterPage })));
const SettingsPage = React.lazy(() =>
  import("@/routes/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm font-medium text-slate-500">
      Loading...
    </div>
  );
}

function routeElement(element: React.ReactNode) {
  return <React.Suspense fallback={<RouteFallback />}>{element}</React.Suspense>;
}

/**
 * Root redirect: send the authenticated user to their role home; anonymous
 * users land on /login. Replaces the legacy shared "/" teacher dashboard so
 * every role's nav is self-consistent (teacher → /teacher, etc.).
 */
function RootRedirect() {
  const currentUser = useCurrentUser();
  if (currentUser.isLoading) {
    return <RouteFallback />;
  }
  if (currentUser.isError || !currentUser.data) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={homeForRole(currentUser.data.role)} replace />;
}

const router = createBrowserRouter([
  { path: "/login", element: routeElement(<LoginPage />) },
  { path: "/register", element: routeElement(<RegisterPage />) },
  { path: "/", element: <RootRedirect /> },
  {
    // Admin workspace.
    path: "/admin",
    element: (
      <RequireRoleSession allowed="admin" homeFor={homeForRole}>
        <AppShell />
      </RequireRoleSession>
    ),
    children: [
      { index: true, element: routeElement(<AdminPlaceholder />) },
      { path: "users", element: routeElement(<AdminUsersPage />) },
      { path: "invites", element: routeElement(<AdminInvitesPage />) },
      { path: "system", element: routeElement(<AdminSystemPage />) },
      { path: "*", element: routeElement(<NotFoundPage />) },
    ],
  },
  {
    // Student workspace.
    path: "/student",
    element: (
      <RequireRoleSession allowed="student" homeFor={homeForRole}>
        <AppShell />
      </RequireRoleSession>
    ),
    children: [
      { index: true, element: routeElement(<StudentDashboardPage />) },
      { path: "courses", element: routeElement(<StudentCoursesPage />) },
      { path: "courses/:courseId", element: routeElement(<StudentCourseDetailPage />) },
      { path: "assignments/:assignmentId", element: routeElement(<StudentAssignmentPage />) },
      { path: "results", element: routeElement(<StudentResultPage />) },
      { path: "*", element: routeElement(<NotFoundPage />) },
    ],
  },
  {
    // Teacher workspace (admin may also view): normalized course→assignment→
    // question→grading workflow. Shared experts/knowledge-base/settings live here.
    path: "/teacher",
    element: (
      <RequireRoleSession allowed={["teacher", "admin"]} homeFor={homeForRole}>
        <AppShell />
      </RequireRoleSession>
    ),
    children: [
      { index: true, element: routeElement(<TeacherDashboardPage />) },
      { path: "courses", element: routeElement(<TeacherCoursesPage />) },
      { path: "courses/:courseId", element: routeElement(<TeacherCourseDetailPage />) },
      { path: "assignments/:assignmentId", element: routeElement(<TeacherAssignmentDetailPage />) },
      { path: "assignments/:assignmentId/edit", element: routeElement(<AssignmentEditorPage />) },
      { path: "assignments/:assignmentId/grading", element: routeElement(<TeacherGradingPage />) },
      { path: "assignments/:assignmentId/submissions", element: routeElement(<TeacherSubmissionsPage />) },
      { path: "assignments/:assignmentId/results", element: routeElement(<TeacherResultsPage />) },
      { path: "knowledge-base", element: routeElement(<KnowledgeBasePage />) },
      { path: "experts", element: routeElement(<ExpertsPage />) },
      { path: "settings", element: routeElement(<SettingsPage />) },
      { path: "*", element: routeElement(<NotFoundPage />) },
    ],
  },
  { path: "*", element: routeElement(<NotFoundPage />) },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </React.StrictMode>,
);
