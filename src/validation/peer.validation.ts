import { assertObject, parseOptionalString, parseString, validationError } from "./common.js";

export type EduCoreTicketInput = {
  eventId: string;
  student: { email: string; name: string };
  course: { courseCode: string; courseName: string | null };
  registrationStatus: "FAILED";
  failureReason: string;
  occurredAt: string;
};

export const parseEduCoreTicket = (value: unknown): EduCoreTicketInput => {
  const body = assertObject(value);
  const student = assertObject(body.student);
  const course = assertObject(body.course);
  const eventId = parseString(body.eventId, "eventId", { min: 1, max: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(eventId)) {
    return validationError("eventId contains unsupported characters");
  }
  const email = parseString(student.email, "student.email", { min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return validationError("student.email must be a valid email address");
  const courseCode = parseString(course.courseCode, "course.courseCode", { min: 2, max: 30 }).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]*$/.test(courseCode)) return validationError("course.courseCode is invalid");
  if (body.registrationStatus !== "FAILED") return validationError("registrationStatus must be FAILED");
  const rawOccurredAt = parseString(body.occurredAt, "occurredAt", { min: 20, max: 40 });
  const occurredAt = new Date(rawOccurredAt);
  if (Number.isNaN(occurredAt.getTime())) return validationError("occurredAt must be a valid ISO-8601 timestamp");
  return {
    eventId,
    student: {
      email,
      name: parseString(student.name, "student.name", { min: 1, max: 120 }),
    },
    course: {
      courseCode,
      courseName: parseOptionalString(course.courseName, "course.courseName", 160) ?? null,
    },
    registrationStatus: "FAILED",
    failureReason: parseString(body.failureReason, "failureReason", { min: 5, max: 1_000 }),
    occurredAt: occurredAt.toISOString(),
  };
};

export type EduCoreRegistrationContext = {
  studentId: string | null;
  courseCode: string;
  registrationStatus: string;
  failureReason: string | null;
  attemptedAt: string;
  additionalContext: Record<string, unknown> | null;
};

export const parseEduCoreContext = (value: unknown): EduCoreRegistrationContext => {
  const body = assertObject(value);
  const attemptedAtValue = parseString(body.attemptedAt, "attemptedAt", { min: 20, max: 40 });
  const attemptedAt = new Date(attemptedAtValue);
  if (Number.isNaN(attemptedAt.getTime())) return validationError("attemptedAt must be a valid ISO-8601 timestamp");
  const additional = body.additionalContext;
  if (additional !== undefined && additional !== null && (typeof additional !== "object" || Array.isArray(additional))) {
    return validationError("additionalContext must be an object or null");
  }
  return {
    studentId: parseOptionalString(body.studentId, "studentId", 128) ?? null,
    courseCode: parseString(body.courseCode, "courseCode", { min: 2, max: 30 }).toUpperCase(),
    registrationStatus: parseString(body.registrationStatus, "registrationStatus", { min: 1, max: 40 }),
    failureReason: parseOptionalString(body.failureReason, "failureReason", 1_000) ?? null,
    attemptedAt: attemptedAt.toISOString(),
    additionalContext: additional ? additional as Record<string, unknown> : null,
  };
};
