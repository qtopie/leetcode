package main

import (
	"fmt"
)

// Category: algorithms
// Level: Hard
// Percent: 65.45684%

// Write a program to solve a Sudoku puzzle by filling the empty cells.
//
// A sudoku solution must satisfy all of the following rules:
//
//
// 	Each of the digits 1-9 must occur exactly once in each row.
// 	Each of the digits 1-9 must occur exactly once in each column.
// 	Each of the digits 1-9 must occur exactly once in each of the 9 3x3 sub-boxes of the grid.
//
//
// The '.' character indicates empty cells.
//
//
// Example 1:
//
// Input: board = [["5","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]
// Output: [["5","3","4","6","7","8","9","1","2"],["6","7","2","1","9","5","3","4","8"],["1","9","8","3","4","2","5","6","7"],["8","5","9","7","6","1","4","2","3"],["4","2","6","8","5","3","7","9","1"],["7","1","3","9","2","4","8","5","6"],["9","6","1","5","3","7","2","8","4"],["2","8","7","4","1","9","6","3","5"],["3","4","5","2","8","6","1","7","9"]]
// Explanation: The input board is shown above and the only valid solution is shown below:
//
//
//
//
//
// Constraints:
//
//
// 	board.length == 9
// 	board[i].length == 9
// 	board[i][j] is a digit or '.'.
// 	It is guaranteed that the input board has only one solution.
//

// Key Points
// 1. how to represent one state  (r,c,v)
// 2. how to move forward and restore state (increase/decrease r, c, v)
// (r,c), v,  input, states -> board
// move forward by i, j
func solveSudoku(board [][]byte) {
	solution := make([][]byte, 9)
	// backtracking
	var _backtracking func(r, c int)
	_backtracking = func(r, c int) {
		// check if satisfied
		if conflict(board, r, c) {
			return
		}

		if c < 9 {
			c++
		} else {
			r, c = r+1, 1
		}

		// check if solution found / end condition
		if r > 9 {
			// write down results
			for i := 0; i < 9; i++ {
				solution[i] = make([]byte, 9)
				copy(solution[i], board[i])
			}
			fmt.Println("found solution")
			return
		}

		// for each slot, it has 9 possible solution
		// try next states and move forward
		for i := 1; i <= 9; i++ {
			state := '0' + byte(i)
			oldState := board[r-1][c-1]
			if oldState == state || oldState == '.' {
				// try next state
				board[r-1][c-1] = state
				_backtracking(r, c)

				// restore state
				board[r-1][c-1] = oldState
			}
		}
	}

	r, c := 1, 1
	// try first state
	for i := 1; i <= 9; i++ {
		state := '0' + byte(i)
		oldState := board[r-1][c-1]
		if oldState == state || oldState == '.' {
			// try next state
			board[r-1][c-1] = state
			_backtracking(r, c)

			// restore state
			board[r-1][c-1] = oldState
		}
	}

	// write down results
	for i := 0; i < 9; i++ {
		copy(board[i], solution[i])
	}
}

func conflict(board [][]byte, r, c int) bool {
	val := board[r-1][c-1]
	// row, col, 3 * 3 subbox checking
	// row checking
	for j := 1; j < c; j++ {
		if board[r-1][j-1] == val {
			return true
		}
	}

	// col checking
	for i := 1; i < r; i++ {
		if board[i-1][c-1] == val {
			return true
		}
	}

	// 3 * 3 subbox checking
	startRow, startCol := ((r-1)/3)*3+1, ((c-1)/3)*3+1
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			row, col := startRow+i, startCol+j
			if board[row-1][col-1] == '.' || row == r && col == c {
				continue
			}

			if board[row-1][col-1] == board[r-1][c-1] {
				return true
			}
		}
	}

	return false
}
