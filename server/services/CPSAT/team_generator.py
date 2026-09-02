#!/usr/bin/env python3
"""
Team Generation using Google OR-Tools CP-SAT Solver
Generates optimal team assignments with constraint satisfaction
"""

import json
import sys
from typing import TypedDict, Optional
from ortools.sat.python import cp_model


StudentDict = TypedDict('StudentDict', {
    'id': str,
    'name': str,
    'major': str,
    'seniority': str,
    'choices': list[str],
    'class': str,
    'previousProject': Optional[str],
    'gender': str,
    'day': Optional[str],
}, total=False)

ProjectDict = TypedDict('ProjectDict', {
    'id': str,
    'name': str,
    'type': str,
    'day': Optional[str],
}, total=False)

ConfigDict = TypedDict('ConfigDict', {
    'min_team_size': int,
    'max_team_size': int,
    'prioritize_returning_students': bool,
    'prioritize_3200_first_choice': bool,
    'balance_gender': bool,
}, total=False)


def generate_teams(students_data: list[StudentDict], projects_data: list[ProjectDict], config: Optional[ConfigDict] = None):
    """
    Generate team assignments using CP-SAT solver

    Args:
        students_data: List of student dictionaries
        projects_data: List of project dictionaries
        config: Configuration dictionary (optional)

    Returns:
        Dictionary mapping project names to lists of student IDs
    """

    # Default configuration
    if config is None:
        config = {
            'min_team_size': 4,
            'max_team_size': 6,
            'prioritize_returning_students': True,
            'prioritize_3200_first_choice': True,
            'balance_gender': True,
        }

    model = cp_model.CpModel()

    # Create indices
    students = {s['id']: s for s in students_data}
    projects = {p['name']: p for p in projects_data}
    student_ids = list(students.keys())
    project_names = list(projects.keys())

    # Decision variables: x[s][p] = 1 if student s is assigned to project p
    x = {}
    for s_id in student_ids:
        x[s_id] = {}
        for p_name in project_names:
            x[s_id][p_name] = model.NewBoolVar(f'x_{s_id}_{p_name}')

    # CONSTRAINT 1: Each student assigned to exactly one project
    for s_id in student_ids:
        model.Add(sum(x[s_id][p_name] for p_name in project_names) == 1)

    # CONSTRAINT 2: Every project's team size must fall within [min_team_size, max_team_size]
    for p_name in project_names:
        team_size = sum(x[s_id][p_name] for s_id in student_ids)
        model.Add(team_size >= config['min_team_size'])
        model.Add(team_size <= config['max_team_size'])

    # CONSTRAINT 3: Only 3200 students can be returning students
    # (Validation - returning students must be 3200)
    for s_id in student_ids:
        student = students[s_id]
        if student.get('previousProject') is not None and student['class'] != '3200':
            raise ValueError(f"Student {s_id} has previousProject but is not 3200 level")

    # CONSTRAINT 4: Day matching - students can only be assigned to projects on their day
    # If a student has a day and a project has a day, they must match
    for s_id in student_ids:
        student = students[s_id]
        student_day = student.get('day')
        if student_day:
            for p_name in project_names:
                project = projects[p_name]
                project_day = project.get('day')
                if project_day and project_day != student_day:
                    model.Add(x[s_id][p_name] == 0)

    # OBJECTIVE: Maximize satisfaction score
    objective_terms = []

    for s_id in student_ids:
        student = students[s_id]
        is_3200 = student['class'] == '3200'
        is_returning = student.get('previousProject') is not None

        for p_name in project_names:
            # Base score from preference ranking
            if p_name in student['choices']:
                pref_index = student['choices'].index(p_name)

                # Score decreases with preference rank
                if pref_index == 0:  # First choice
                    base_score = 1000
                elif pref_index == 1:  # Second choice
                    base_score = 500
                elif pref_index == 2:  # Third choice
                    base_score = 200
                elif pref_index == 3:  # Fourth choice
                    base_score = 100
                elif pref_index == 4:  # Fifth choice
                    base_score = 50
                elif pref_index == 5:  # Sixth choice
                    base_score = 25
                else:
                    base_score = 0

                # 3200 students heavily prioritize first choice
                if is_3200 and config.get('prioritize_3200_first_choice', True):
                    base_score *= 100  # 100x multiplier for 3200 students

                # Returning student bonus: 3200 students CAN choose any project, but if they
                # include their previous project in their choices, boost that assignment's score.
                if config.get('prioritize_returning_students', True) and is_returning and student['previousProject'] == p_name:
                    base_score *= 1.5

                objective_terms.append(base_score * x[s_id][p_name])

    # SOFT CONSTRAINT: Gender balance (add penalty for imbalanced teams)
    if config.get('balance_gender', True):
        for p_name in project_names:
            # Count students of each gender on this team
            gender_vars = {'Male': [], 'Female': [], 'Prefer not to say': []}

            for s_id in student_ids:
                student = students[s_id]
                gender = student.get('gender', 'Prefer not to say')
                if gender in gender_vars:
                    gender_vars[gender].append(x[s_id][p_name])

            # Create variables for gender counts
            male_count = model.NewIntVar(0, config['max_team_size'], f'male_count_{p_name}')
            female_count = model.NewIntVar(0, config['max_team_size'], f'female_count_{p_name}')

            if gender_vars['Male']:
                model.Add(male_count == sum(gender_vars['Male']))
            else:
                model.Add(male_count == 0)

            if gender_vars['Female']:
                model.Add(female_count == sum(gender_vars['Female']))
            else:
                model.Add(female_count == 0)

            # Penalty variable for male isolation
            male_isolated = model.NewBoolVar(f'male_isolated_{p_name}')
            model.Add(male_count == 1).OnlyEnforceIf(male_isolated)
            model.Add(male_count != 1).OnlyEnforceIf(male_isolated.Not())

            # Penalty variable for female isolation
            female_isolated = model.NewBoolVar(f'female_isolated_{p_name}')
            model.Add(female_count == 1).OnlyEnforceIf(female_isolated)
            model.Add(female_count != 1).OnlyEnforceIf(female_isolated.Not())

            # Apply penalty (negative score) for isolation
            objective_terms.append(-500 * male_isolated)  # Penalty for 1 male among others
            objective_terms.append(-500 * female_isolated)  # Penalty for 1 female among others

    # SOFT CONSTRAINT: Major fit based on project type (software/hardware adjacency)
    software_majors = {'CS', 'SE', 'DS'}
    hardware_majors = {'EE', 'ME', 'BME', 'CE'}

    for p_name in project_names:
        project = projects[p_name]
        project_type = project.get('type', '')

        for s_id in student_ids:
            student = students[s_id]
            student_major = student['major']
            bonus = 0

            # "Both" projects accept all majors - give bonus to everyone
            if project_type == 'Both':
                bonus = 80
            # SW projects: bonus for software-adjacent majors
            elif project_type == 'SW' and student_major in software_majors:
                bonus = 60
            # HW projects: bonus for hardware-adjacent majors
            elif project_type == 'HW' and student_major in hardware_majors:
                bonus = 60

            if bonus > 0:
                objective_terms.append(bonus * x[s_id][p_name])

    # Maximize total satisfaction
    model.Maximize(sum(objective_terms))

    # Solve
    solver = cp_model.CpSolver()

    # Set time limit (30 seconds)
    solver.parameters.max_time_in_seconds = 30.0

    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        # Extract solution
        teams = {p_name: [] for p_name in project_names}

        for s_id in student_ids:
            for p_name in project_names:
                if solver.Value(x[s_id][p_name]) == 1:
                    teams[p_name].append(s_id)
                    break

        return {
            'success': True,
            'teams': teams,
            'score': solver.ObjectiveValue(),
            'solve_time': solver.WallTime(),
            'status': 'optimal' if status == cp_model.OPTIMAL else 'feasible',
        }
    else:
        total_students = len(student_ids)
        total_teams = len(project_names)
        min_capacity = total_teams * config['min_team_size']
        max_capacity = total_teams * config['max_team_size']

        if total_students < min_capacity:
            error = (
                f'Not enough students: {total_students} student(s) across {total_teams} team(s), '
                f'but a minimum team size of {config["min_team_size"]} requires at least {min_capacity}. '
                'Lower the minimum team size, enroll more students, or reduce the number of active teams.'
            )
        elif total_students > max_capacity:
            error = (
                f'Too many students: {total_students} student(s) across {total_teams} team(s), '
                f'but a maximum team size of {config["max_team_size"]} allows at most {max_capacity}. '
                'Raise the maximum team size, add more teams, or reduce enrollment for this semester and day.'
            )
        else:
            error = (
                f'No assignment exists that keeps every team within the configured min/max team size, '
                f'even though {total_students} student(s) fits the overall capacity for {total_teams} team(s) '
                '(this can happen when other requirements, such as meeting-day splits, prevent a valid '
                'assignment). Try adjusting min/max team size, or the set of active projects/teams for '
                'this semester and day.'
            )

        return {
            'success': False,
            'error': error,
        }


def main():
    """Main entry point when called from command line"""
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())

        students = input_data['students']
        projects = input_data['projects']
        config = input_data.get('config', None)

        # Generate teams
        result = generate_teams(students, projects, config)

        # Output result as JSON
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
